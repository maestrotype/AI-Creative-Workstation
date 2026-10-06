"""Keep a marked word in the same cloned voice as the rest of the line.

The stress mark is not spoken. The word is synthesized by the same model as the
sentence, then the chosen vowel is lengthened and the old stressed vowel is
shortened. That is how Russian stress is heard, without a second voice and
without repeating a letter.
"""
from __future__ import annotations

import re

import numpy as np

_PLUS_VOWEL = re.compile(r"\+[аеёиоуыэюя]", re.IGNORECASE)
_STRESS_WORD = re.compile(
    r"[0-9A-Za-z\u0400-\u04FF-]*\+[аеёиоуыэюя][0-9A-Za-z\u0400-\u04FF-]*",
    re.IGNORECASE,
)
_LETTER = re.compile(r"[0-9A-Za-z\u0400-\u04FF]")
_VOWELS = set("аеёиоуыэюя")

OUTPUT_SR = 24000


def needs_stress_engine(text: str) -> bool:
    return bool(_PLUS_VOWEL.search(text or ""))


def stress_pieces(text: str) -> list[tuple[str, bool]]:
    """Plain runs stay whole. A marked word is its own piece, still for the same voice."""
    raw = text or ""
    pieces: list[tuple[str, bool]] = []
    last = 0
    for match in _STRESS_WORD.finditer(raw):
        before = raw[last:match.start()]
        if _LETTER.search(before):
            pieces.append((before.strip(), False))
        pieces.append((match.group(0), True))
        last = match.end()
    tail = raw[last:]
    if _LETTER.search(tail):
        pieces.append((tail.strip(), False))
    if pieces:
        return pieces
    stripped = raw.strip()
    return [(stripped, False)] if stripped else []


def vowel_stress_index(marked: str) -> int | None:
    """п+екарь → 0, парфюм+ер → 2. Index among vowels, not letters."""
    index = 0
    chars = (marked or "").lower()
    pos = 0
    while pos < len(chars):
        if chars[pos] == "+" and pos + 1 < len(chars) and chars[pos + 1] in _VOWELS:
            return index
        if chars[pos] in _VOWELS:
            index += 1
        pos += 1
    return None


def _trim(wav: np.ndarray, sr: int) -> np.ndarray:
    import librosa

    arr = np.asarray(wav, dtype="float32")
    if arr.size == 0:
        return arr
    trimmed, _ = librosa.effects.trim(arr, top_db=40)
    if trimmed.size == 0:
        return arr
    pad = int(0.03 * sr)
    return np.pad(trimmed, (0, pad))


def _join(chunks: list[np.ndarray], sr: int, fade_sec: float = 0.02) -> np.ndarray:
    usable = [chunk for chunk in chunks if chunk.size]
    if not usable:
        return np.zeros(1, dtype="float32")
    fade_n = int(fade_sec * sr)
    acc = usable[0]
    for nxt in usable[1:]:
        if acc.size < fade_n or nxt.size < fade_n:
            acc = np.concatenate([acc, nxt])
            continue
        fade = np.linspace(1.0, 0.0, fade_n, dtype="float32")
        mid = acc[-fade_n:] * fade + nxt[:fade_n] * (1.0 - fade)
        acc = np.concatenate([acc[:-fade_n], mid, nxt[fade_n:]])
    peak = float(np.abs(acc).max()) if acc.size else 0.0
    if peak > 0:
        acc = acc / peak * 0.89
    return acc


def _stretch(segment: np.ndarray, rate: float) -> np.ndarray:
    import librosa

    seg = np.asarray(segment, dtype="float32")
    if seg.size < 300 or abs(rate - 1.0) < 0.05:
        return seg
    n_fft = 256 if seg.size < 2048 else 512
    try:
        return np.asarray(
            librosa.effects.time_stretch(seg, rate=rate, n_fft=n_fft, hop_length=n_fft // 4),
            dtype="float32",
        )
    except Exception:
        return seg


def _vowel_spans(wav: np.ndarray, sr: int, count: int) -> list[tuple[int, int]] | None:
    import librosa

    hop = 256
    if wav.size < hop * 8 or count < 1:
        return None
    spec = np.abs(librosa.stft(wav, n_fft=512, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=512)
    env = spec[(freqs >= 250) & (freqs <= 2800)].mean(axis=0)
    win = max(3, int(0.025 * sr / hop))
    env = np.convolve(env, np.ones(win) / win, mode="same")
    if float(env.max()) <= 1e-6:
        return None
    min_dist = max(2, int(0.07 * sr / hop))
    threshold = float(env.max()) * 0.38
    peaks: list[int] = []
    pos = 1
    while pos < len(env) - 1:
        loud = env[pos] >= threshold and env[pos] >= env[pos - 1] and env[pos] >= env[pos + 1]
        if loud:
            if not peaks or pos - peaks[-1] >= min_dist:
                peaks.append(pos)
            elif env[pos] > env[peaks[-1]]:
                peaks[-1] = pos
        pos += 1
    if len(peaks) > count:
        peaks = sorted(sorted(peaks, key=lambda peak: env[peak], reverse=True)[:count])
    if len(peaks) != count:
        return None
    # Tight window around each peak. The decay after the last vowel is not a vowel.
    spans: list[tuple[int, int]] = []
    min_w = max(2, int(0.045 * sr / hop))
    for order, peak in enumerate(peaks):
        left_limit = 0 if order == 0 else (peaks[order - 1] + peak) // 2
        right_limit = len(env) - 1 if order == len(peaks) - 1 else (peak + peaks[order + 1]) // 2
        level = float(env[peak]) * 0.55
        left = peak
        while left > left_limit and env[left] > level:
            left -= 1
        right = peak
        while right < right_limit and env[right] > level:
            right += 1
        if right - left < min_w:
            extra = min_w - (right - left)
            left = max(left_limit, left - extra // 2)
            right = min(right_limit, left + min_w)
        sample_start = max(0, left * hop)
        sample_end = min(wav.size, max(right, left + 1) * hop)
        if sample_end - sample_start < int(0.03 * sr):
            return None
        spans.append((sample_start, sample_end))
    return spans


def shift_stress(wav: np.ndarray, sr: int, marked: str) -> np.ndarray:
    """Lengthen the vowel the user marked. Leave the word on this same recording."""
    index = vowel_stress_index(marked)
    plain = (marked or "").replace("+", "")
    vowel_count = sum(1 for char in plain.lower() if char in _VOWELS)
    if index is None or vowel_count < 1 or index >= vowel_count:
        return wav
    arr = np.asarray(wav, dtype="float32")
    spans = _vowel_spans(arr, sr, vowel_count)
    if not spans:
        return arr
    # Russian stress is a longer vowel. Duration decides, loudness only breaks a tie.
    weights = []
    for start, end in spans:
        mid0 = start + (end - start) // 4
        mid1 = end - (end - start) // 4
        piece = arr[mid0:max(mid1, mid0 + 1)]
        weights.append((end - start) * float(np.sqrt(np.mean(piece ** 2))))
    dominant = int(np.argmax(weights))
    if dominant == index:
        return arr
    target_len = spans[index][1] - spans[index][0]
    dominant_len = spans[dominant][1] - spans[dominant][0]
    # The marked vowel has to come out longer than the one that was stressed.
    goal = max(target_len, int(dominant_len * 1.15))
    lengthen = max(0.58, min(0.92, target_len / goal))
    shortened = max(int(goal * 0.72), int(0.04 * sr))
    compress = max(1.08, min(1.55, dominant_len / shortened))
    pieces = [arr[:spans[0][0]]]
    for span_index, (start, end) in enumerate(spans):
        if span_index:
            pieces.append(arr[spans[span_index - 1][1]:start])
        segment = arr[start:end]
        if span_index == index:
            segment = _stretch(segment, lengthen) * 1.06
        elif span_index == dominant:
            segment = _stretch(segment, compress) * 0.94
        pieces.append(np.asarray(segment, dtype="float32"))
    pieces.append(arr[spans[-1][1]:])
    out = _join(pieces, sr, fade_sec=0.004)
    peak = float(np.abs(arr).max()) if arr.size else 0.0
    out_peak = float(np.abs(out).max()) if out.size else 0.0
    if peak > 0 and out_peak > 0:
        out = out / out_peak * peak
    return out


def mix_stressed_segment(text: str, say_plain) -> np.ndarray:
    """Every piece, including a marked word, is spoken by ``say_plain``."""
    chunks: list[np.ndarray] = []
    for part, stressed in stress_pieces(text):
        spoken = part.replace("+", "") if stressed else part
        wav = np.asarray(say_plain(spoken), dtype="float32")
        if stressed:
            wav = shift_stress(wav, OUTPUT_SR, part)
        chunks.append(_trim(wav, OUTPUT_SR))
    return _join(chunks, OUTPUT_SR)
