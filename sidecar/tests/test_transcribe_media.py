import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from transcribe import transcribe_media  # noqa: E402


class TranscribeMediaTests(unittest.TestCase):
    def test_missing_file_does_not_load_whisper(self):
        result = transcribe_media("/tmp/acw-missing-voice-message.wav", language="ru")
        self.assertEqual(result["warnings"], ["FILE_NOT_FOUND"])
        self.assertEqual(result["full_text"], "")
        self.assertEqual(result["segments"], [])


if __name__ == "__main__":
    unittest.main()
