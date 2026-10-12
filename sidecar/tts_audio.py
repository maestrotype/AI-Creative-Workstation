"""Drop the pauses XTTS leaves inside one line, without cutting the words."""
from __future__ import annotations

import numpy as np

# A breath shorter than this stays. Anything longer is a hole, not phrasing.
_MAX_SILENCE_SEC = 0.28
_KEEP_SILENCE_SEC = 0.04
_EDGE_PAD_SEC = 0.03
_FADE_SEC = 0.006


def _frame_rms(wav: np.ndarray, hop: int) -> np.ndarray:
    usable = wav.size // hop * hop
    if usable < hop:
        return np.zeros(0, dtype="float32")
    frames = wav[:usable].reshape(-1, hop)
    return np.sqrt(np.mean(frames ** 2, axis=1))


def _silence_threshold(rms: np.ndarray) -> float:
    if rms.size == 0:
        return 1.0
    loud = float(np.percentile(rms, 90))
    return max(0.012, loud * 0.12)


def _crossfade(left: np.ndarray, right: np.ndarray, fade_n: int) -> np.ndarray:
    if left.size == 0:
        return right
    if right.size == 0:
        return left
    fade_n = min(fade_n, left.size, right.size)
    if fade_n < 2:
        return np.concatenate([left, right])
    fade = np.linspace(1.0, 0.0, fade_n, dtype="float32")
    mid = left[-fade_n:] * fade + right[:fade_n] * (1.0 - fade)
    return np.concatenate([left[:-fade_n], mid, right[fade_n:]])


def _fade_edges(wav: np.ndarray, sr: int) -> np.ndarray:
    fade_n = int(_FADE_SEC * sr)
    if wav.size < fade_n * 4 or fade_n < 2:
        return wav
    out = wav.copy()
    ramp = np.linspace(0.0, 1.0, fade_n, dtype="float32")
    out[:fade_n] *= ramp
    out[-fade_n:] *= ramp[::-1]
    return out


def clean_speech(wav: np.ndarray, sr: int) -> np.ndarray:
    """Trim the edges and collapse a silence longer than a short breath.

    Sentence audio from XTTS often contains multi-second holes. Those play as
    pauses inside a single timeline clip. Words themselves are left alone.
    """
    arr = np.asarray(wav, dtype="float32").reshape(-1)
    if arr.size < int(0.2 * sr):
        return arr
    hop = max(1, int(0.02 * sr))
    rms = _frame_rms(arr, hop)
    if rms.size == 0:
        return arr
    threshold = _silence_threshold(rms)
    silent = rms < threshold
    max_frames = max(1, int(_MAX_SILENCE_SEC / 0.02))
    keep_frames = max(1, int(_KEEP_SILENCE_SEC / 0.02))
    fade_n = int(_FADE_SEC * sr)

    pieces: list[np.ndarray] = []
    index = 0
    while index < silent.size:
        if not silent[index]:
            start = index
            while index < silent.size and not silent[index]:
                index += 1
            pieces.append(arr[start * hop:index * hop])
            continue
        start = index
        while index < silent.size and silent[index]:
            index += 1
        run = index - start
        if run <= max_frames:
            pieces.append(arr[start * hop:index * hop])
            continue
        mid = start + run // 2
        keep_from = max(start, mid - keep_frames // 2)
        keep_to = min(index, keep_from + keep_frames)
        pieces.append(arr[keep_from * hop:keep_to * hop])

    if not pieces:
        return arr
    joined = pieces[0]
    for piece in pieces[1:]:
        joined = _crossfade(joined, piece, fade_n)

    # Leading and trailing quiet that the frame walk still left on the ends.
    edge_rms = _frame_rms(joined, hop)
    if edge_rms.size:
        voiced = np.where(edge_rms >= threshold)[0]
        if voiced.size:
            pad = int(_EDGE_PAD_SEC * sr)
            begin = max(0, int(voiced[0]) * hop - pad)
            end = min(joined.size, (int(voiced[-1]) + 1) * hop + pad)
            joined = joined[begin:end]
    return _fade_edges(joined, sr)


def finish_speech(wav: np.ndarray, sr: int, peak: float = 0.89) -> np.ndarray:
    cleaned = clean_speech(wav, sr)
    level = float(np.abs(cleaned).max()) if cleaned.size else 0.0
    if level > 0:
        cleaned = cleaned / level * peak
    return _fade_edges(cleaned, sr)
