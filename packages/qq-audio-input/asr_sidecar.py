#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地 ASR 侧车：OpenAI 兼容 /transcriptions 端点（multipart: file=wav + model）。

独立 QQ Audio Input 包保留的可选手动服务；插件不会自动启动此脚本。
无需写死密钥：纯本地、离线，CPU 即可。

引擎：
  - vosk          ：轻量离线，中文小模型（推荐）。pip install vosk + 下载中文模型目录。
  - fasterWhisper ：更准，但首次需下载模型（HF 可能受限）。pip install faster-whisper。
  - funasr        ：SenseVoiceSmall，中文/多语更准，CPU 推理。pip install funasr；
                    模型目录留空则自动从 ModelScope 下载（iic/SenseVoiceSmall），也可通过 --model-dir 指定本地目录。

手动用法：
  python asr_sidecar.py <port> --engine funasr --model-dir <本地模型目录或留空>
  （模型目录由使用者显式指定；funasr 留空时可能联网下载模型。）
"""
import argparse
import io
import json
import os
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ENGINE = None
ENGINE_NAME = ""
READY = False


def load_engine(engine: str, model_dir: str) -> None:
    engine = (engine or "funasr").lower()
    global ENGINE, ENGINE_NAME, READY
    if engine == "vosk":
        from vosk import KaldiRecognizer, Model
        ENGINE = (Model, KaldiRecognizer, Model(model_dir))
        ENGINE_NAME = "vosk"
    elif engine in ("fasterwhisper", "faster_whisper", "whisper"):
        from faster_whisper import WhisperModel
        ENGINE = WhisperModel(model_dir or "base", device="cpu", compute_type="int8")
        ENGINE_NAME = "fasterWhisper"
    elif engine in ("funasr", "sensevoice"):
        # 本机 GPU 运行期必崩（cudaErrorUnknown），强制 CPU 推理；必须在 import torch 前设置
        os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")
        from funasr import AutoModel

        # 模型目录留空或无效 → 自动从 ModelScope 下载/缓存 iic/SenseVoiceSmall；指定有效目录则用本地
        model_id = model_dir if (model_dir and os.path.isdir(model_dir)) else "iic/SenseVoiceSmall"
        ENGINE = AutoModel(
            model=model_id,
            model_revision="master",
            device="cpu",
            disable_update=True,
            hub="modelscope",
        )
        ENGINE_NAME = "funasr"
    elif engine in ("sherpaonnx", "sherpa-onnx", "sherpa_onnx"):
        # 228MB int8 量化版（SenseVoiceSmall q8）：省内存、更快。模型需本地目录，
        # 优先 model_q8.onnx，退化用 fp32 model.onnx；二者均需同目录 tokens.txt。
        os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")
        import sherpa_onnx

        onnx_path = ""
        tokens_path = ""
        if model_dir and os.path.isdir(model_dir):
            for cand in ("model_q8.onnx", "model.onnx"):
                p = os.path.join(model_dir, cand)
                if os.path.isfile(p):
                    onnx_path = p
                    break
            tp = os.path.join(model_dir, "tokens.txt")
            if os.path.isfile(tp):
                tokens_path = tp
        if not onnx_path or not tokens_path:
            raise ValueError(
                "sherpaOnnx 需要含 model_q8.onnx(或 model.onnx) 与 tokens.txt 的目录，未找到；"
                "请在 asr.localModelPath 指定，或先在控制台「语音模型」面板点下载"
            )
        ENGINE = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=onnx_path,
            tokens=tokens_path,
            num_threads=2,
            language="auto",
            use_itn=True,
            provider="cpu",
        )
        ENGINE_NAME = "sherpaOnnx"
    else:
        raise ValueError("未知引擎: " + str(engine))
    READY = True


def read_wav_pcm(data: bytes):
    """解析 WAV → (rate, channels, pcm_int16_bytes)。仅处理 16-bit PCM；非 WAV 按裸 16-bit/16k/单声道处理。"""
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        if len(data) % 2:
            raise ValueError("Raw PCM must contain complete 16-bit samples")
        return 16000, 1, data
    import struct

    p = 12
    end = struct.unpack("<I", data[4:8])[0] + 8
    if end > len(data) or end < 12:
        raise ValueError("Truncated WAV container")
    rate = channels = bits = None
    chunks = []
    while p + 8 <= end:
        cid = data[p : p + 4]
        sz = struct.unpack("<I", data[p + 4 : p + 8])[0]
        p += 8
        if p + sz > end:
            raise ValueError("Truncated WAV chunk")
        if cid == b"fmt ":
            if sz < 16:
                raise ValueError("Invalid WAV format chunk")
            fmt, channels, rate, _, align, bits = struct.unpack("<HHIIHH", data[p : p + 16])
            if fmt != 1 or bits != 16 or channels < 1 or rate < 1 or align != channels * 2:
                raise ValueError("Only 16-bit PCM WAV audio is supported")
        elif cid == b"data":
            chunks.append(data[p : p + sz])
        # RIFF chunks are word-aligned; their declared size excludes padding.
        p += sz + (sz % 2)
    pcm = b"".join(chunks)
    if channels is None or not pcm or len(pcm) % (channels * 2):
        raise ValueError("Missing or incomplete WAV audio frames")
    if channels != 1 or rate != 16000:
        import numpy as np

        arr = np.frombuffer(pcm, dtype="<i2").astype(np.float32)
        if channels > 1:
            arr = arr.reshape(-1, channels).mean(axis=1)
        if rate != 16000:
            n = int(round(len(arr) * 16000 / rate))
            xs = np.linspace(0, len(arr) - 1, max(n, 1))
            arr = np.interp(xs, np.arange(len(arr)), arr)
        pcm = arr.astype("<i2").tobytes()
    return 16000, 1, pcm


def transcribe(data: bytes, model: str) -> str:
    if ENGINE_NAME == "vosk":
        Model, KaldiRecognizer, m = ENGINE
        _, _, pcm = read_wav_pcm(data)
        rec = KaldiRecognizer(m, 16000)
        text = []
        if rec.AcceptWaveform(pcm):
            text.append(json.loads(rec.Result()).get("text") or "")
        text.append(json.loads(rec.FinalResult()).get("text") or "")
        return " ".join(part.strip() for part in text if part.strip())
    elif ENGINE_NAME == "funasr":
        import re
        import tempfile
        import wave

        _, _, pcm = read_wav_pcm(data)
        fd, path = tempfile.mkstemp(suffix=".wav")
        try:
            with os.fdopen(fd, "wb") as f:
                w = wave.open(f, "wb")
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(16000)
                w.writeframes(pcm)
            res = ENGINE.generate(input=[path], language="auto", use_itn=True, batch_size=1)
            text = ""
            if res and isinstance(res, list) and res:
                item = res[0]
                text = item.get("text", "") if isinstance(item, dict) else str(item)
            # 清洗 SenseVoice 输出标签：如 <|zh|> <|NEUTRAL|> <|HAPPY|> <|en|> 等
            text = re.sub(r"<\|[^|]*\|>", "", text).strip()
            return text
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
    elif ENGINE_NAME == "sherpaOnnx":
        import re
        import numpy as np

        _, _, pcm = read_wav_pcm(data)
        arr = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        stream = ENGINE.create_stream()
        stream.accept_waveform(16000, arr)
        ENGINE.decode_stream(stream)
        res = stream.result
        text = getattr(res, "text", None)
        if not text and isinstance(res, dict):
            text = res.get("text")
        # 清洗 SenseVoice 输出标签：如 <|zh|> <|NEUTRAL|> <|HAPPY|> <|en|> 等
        text = re.sub(r"<\|[^|]*\|>", "", text or "").strip()
        return text
    else:
        import numpy as np

        _, _, pcm = read_wav_pcm(data)
        arr = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        segs, _ = ENGINE.transcribe(arr, language="zh", beam_size=5)
        return "".join(s.text for s in segs).strip()


def parse_multipart(body: bytes, boundary: bytes):
    """Parse MIME boundaries without trimming binary audio payload bytes."""
    from email.parser import BytesParser
    from email.policy import default

    if not boundary or any(char in boundary for char in (b"\r", b"\n")):
        raise ValueError("Invalid multipart boundary")
    quoted = boundary.replace(b"\\", b"\\\\").replace(b'"', b'\\"')
    message = BytesParser(policy=default).parsebytes(
        b'Content-Type: multipart/form-data; boundary="' + quoted + b'"\r\nMIME-Version: 1.0\r\n\r\n' + body
    )
    if not message.is_multipart():
        raise ValueError("Invalid multipart body")
    parts: dict[str, bytes] = {}
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        content = part.get_payload(decode=True)
        if isinstance(name, str) and isinstance(content, bytes):
            parts[name] = content
    return parts


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, obj) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/health"):
            self._send(200, {"ready": READY, "engine": ENGINE_NAME, "state": "ok" if READY else "loading"})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        # 接受：OpenAI 兼容 /transcriptions、/v1/audio/transcriptions、根路径裸 WAV（call.asrMode='local' 默认），
        # 以及 /asr（QQ 语音收发 transcribeViaService 用 multipart/file 调用，便于 voice 复用本侧车）。
        accept = (
            self.path == '/'
            or self.path == ''
            or self.path.startswith("/transcriptions")
            or self.path.startswith("/v1/audio/transcriptions")
            or self.path.startswith("/asr")
        )
        if not accept:
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length <= 0:
                raise ValueError("Invalid content length")
            body = self.rfile.read(length)
        except Exception:
            self._send(400, {"error": "bad request"})
            return
        audio = None
        model = ""
        if self.headers.get_content_type() == "multipart/form-data":
            try:
                bnd = (self.headers.get_param("boundary") or "").encode("utf-8")
                parts = parse_multipart(body, bnd)
            except (ValueError, UnicodeError):
                self._send(400, {"error": "invalid multipart body"})
                return
            audio = parts.get("file")
            model = (parts.get("model") or b"").decode("utf-8", "ignore")
        else:
            audio = body  # 裸 WAV
        if not audio:
            self._send(400, {"error": "missing audio"})
            return
        if not READY:
            self._send(503, {"error": "model not ready"})
            return
        try:
            text = transcribe(audio, model)
            self._send(200, {"text": text})
        except ValueError as e:
            self._send(400, {"error": str(e)})
        except Exception as e:  # noqa
            self._send(500, {"error": str(e), "trace": traceback.format_exc()})

    def log_message(self, *a):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("port", type=int)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--engine", default="funasr")
    ap.add_argument("--model-dir", default="")
    args = ap.parse_args()
    try:
        load_engine(args.engine, args.model_dir)
    except Exception as e:  # noqa
        sys.stderr.write("ASR_SIDECAR_LOAD_FAIL: " + str(e) + "\n")
        sys.stderr.flush()
        sys.exit(2)
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    sys.stdout.write("ASR_SIDECAR_READY engine=%s port=%d\n" % (ENGINE_NAME, args.port))
    sys.stdout.flush()
    srv.serve_forever()


if __name__ == "__main__":
    main()
