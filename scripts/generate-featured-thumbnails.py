"""Extract small, real video frames for the hand-picked dialogue cards.

Reads the local imported catalog and source MP4 files without modifying either.
Requires Python OpenCV (cv2). Run from the project root.
"""

import json
from pathlib import Path

import cv2


ROOT = Path(__file__).resolve().parents[1]
PICKS = ["S01E02-0050", "S01E15-0050", "S01E16-0058", "S01E17-0034", "S01E02-0023", "S01E16-0042"]
SOURCE_CATALOG = ROOT / "data" / "dialogues.json"
SOURCE_MEDIA = ROOT / "media"
OUTPUT_DIR = ROOT / "assets" / "featured"
MAX_WIDTH = 640


def main():
    lines = json.loads(SOURCE_CATALOG.read_text(encoding="utf-8"))
    by_id = {line["id"]: line for line in lines}
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for line_id in PICKS:
        line = by_id.get(line_id)
        if not line:
            raise SystemExit(f"精选台词不存在：{line_id}；请确认本地已导入对应剧集。")
        video_path = SOURCE_MEDIA / f"{line['episode']}.mp4"
        if not video_path.is_file():
            raise SystemExit(f"缺少视频素材：{video_path}")

        capture = cv2.VideoCapture(str(video_path))
        if not capture.isOpened():
            raise SystemExit(f"无法读取视频：{video_path}")
        try:
            capture.set(cv2.CAP_PROP_POS_MSEC, float(line["start"]) * 1000)
            ok, frame = capture.read()
        finally:
            capture.release()
        if not ok or frame is None:
            raise SystemExit(f"无法提取 {line_id} 在 {line['start']} 秒处的画面。")

        height, width = frame.shape[:2]
        target_width = min(MAX_WIDTH, width)
        target_height = round(height * target_width / width)
        thumbnail = cv2.resize(frame, (target_width, target_height), interpolation=cv2.INTER_AREA)
        destination = OUTPUT_DIR / f"{line_id}.jpg"
        if not cv2.imwrite(str(destination), thumbnail, [cv2.IMWRITE_JPEG_QUALITY, 84]):
            raise SystemExit(f"无法写入缩略图：{destination}")
        print(f"{line_id}: {line['episode']} @ {line['start']:.2f}s -> {destination.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
