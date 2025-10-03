#!/usr/bin/env python3
import os, sys

def main():
    if len(sys.argv) < 2:
        print("Usage: transcribe.py <audio_path>", file=sys.stderr)
        sys.exit(2)

    audio_path = sys.argv[1]
    # Try faster-whisper if available, fall back to whisper if available, else fail.
    try:
        from faster_whisper import WhisperModel
        model_size = os.getenv("WHISPER_MODEL", "base")
        model = WhisperModel(model_size)
        segments, info = model.transcribe(audio_path)
        text = "".join(seg.text for seg in segments).strip()
        print(text)
        return
    except Exception as e:
        pass

    try:
        import whisper
        model_size = os.getenv("WHISPER_MODEL", "base")
        model = whisper.load_model(model_size)
        result = model.transcribe(audio_path)
        print(result.get("text","").strip())
        return
    except Exception as e:
        print("Whisper not available: " + str(e), file=sys.stderr)
        sys.exit(3)

if __name__ == "__main__":
    main()
