"""ASR protocol regressions: standard library only; no model download required."""
import importlib.util
import io
from http.client import HTTPMessage
from pathlib import Path
import struct
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("asr_sidecar", Path(__file__).parents[1] / "asr_sidecar.py")
sidecar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sidecar)


def wav(pcm, extra=b"", bits=16, fmt=1):
    format_data = struct.pack("<HHIIHH", fmt, 1, 16000, 16000 * bits // 8, bits // 8, bits)
    chunks = b"fmt " + struct.pack("<I", len(format_data)) + format_data + extra
    chunks += b"data" + struct.pack("<I", len(pcm)) + pcm
    return b"RIFF" + struct.pack("<I", len(chunks) + 4) + b"WAVE" + chunks


class ProtocolTests(unittest.TestCase):
    def test_multipart_keeps_binary_line_endings_and_embedded_boundary_text(self):
        boundary = b"test-boundary"
        for audio in (b"\x01\x02\r\n", b"\r\n\x01\x02\n\r", b"\x01--test-boundary\x02"):
            body = b"--" + boundary + b'\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n'
            body += audio + b"\r\n--" + boundary + b"--\r\n"
            self.assertEqual(sidecar.parse_multipart(body, boundary)["file"], audio)

    def test_wav_skips_odd_sized_riff_chunk_padding(self):
        audio = b"\x01\x02\x03\x04"
        junk = b"JUNK" + struct.pack("<I", 1) + b"x\x00"
        with patch.dict("sys.modules", {"numpy": types.SimpleNamespace()}):
            self.assertEqual(sidecar.read_wav_pcm(wav(audio, extra=junk)), (16000, 1, audio))

    def test_wav_rejects_unsupported_sample_encoding(self):
        with patch.dict("sys.modules", {"numpy": types.SimpleNamespace()}):
            with self.assertRaises(ValueError):
                sidecar.read_wav_pcm(wav(b"\x00\x00\x00\x00", fmt=3))

    def test_wav_rejects_truncated_pcm_frame(self):
        with patch.dict("sys.modules", {"numpy": types.SimpleNamespace()}):
            with self.assertRaises(ValueError):
                sidecar.read_wav_pcm(wav(b"\x01\x02\x03"))

    def test_vosk_flushes_the_final_audio_segment(self):
        class Recognizer:
            def __init__(self, *_): pass
            def AcceptWaveform(self, _): return False
            def Result(self): return '{"text":""}'
            def FinalResult(self): return '{"text":"完整结尾"}'
        with patch.object(sidecar, "ENGINE_NAME", "vosk"), patch.object(sidecar, "ENGINE", (object, Recognizer, object())):
            self.assertEqual(sidecar.transcribe(b"\x00\x00", ""), "完整结尾")

    def request(self, body, content_type, length=None):
        handler = sidecar.Handler.__new__(sidecar.Handler)
        handler.path = "/asr"
        handler.headers = HTTPMessage()
        handler.headers["Content-Type"] = content_type
        handler.headers["Content-Length"] = str(len(body) if length is None else length)
        handler.rfile = io.BytesIO(body)
        response = []
        handler._send = lambda code, obj: response.append((code, obj))
        handler.do_POST()
        return response

    def test_http_accepts_quoted_boundary_with_other_content_type_parameters(self):
        body = b'--boundary\r\nContent-Disposition: form-data; name="file"\r\n\r\n\x01\x02\r\n--boundary--\r\n'
        with patch.object(sidecar, "READY", True), patch.object(sidecar, "transcribe", return_value="ok") as transcribe:
            response = self.request(body, 'Multipart/Form-Data; boundary="boundary"; charset=UTF-8')
            self.assertEqual(response, [(200, {"text": "ok"})])
            transcribe.assert_called_once_with(b"\x01\x02", "")

    def test_http_rejects_negative_content_length_before_transcription(self):
        with patch.object(sidecar, "READY", True), patch.object(sidecar, "transcribe", return_value="ok") as transcribe:
            response = self.request(b"\x01\x02", "audio/wav", -1)
            self.assertEqual(response[0][0], 400)
            transcribe.assert_not_called()

    def test_http_rejects_missing_multipart_boundary(self):
        response = self.request(b"invalid multipart", "multipart/form-data")
        self.assertEqual(response[0][0], 400)


if __name__ == "__main__":
    unittest.main()
