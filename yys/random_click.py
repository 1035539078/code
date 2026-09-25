#!/usr/bin/env python3
"""在 100×100 像素区域内随机落点，并在指定秒数之后再随机等待 1～3 秒点击。

用法（在 E:\\code\\yys 目录下）:
    python random_click.py
    python random_click.py 20
    python random_click.py 20 --origin 400 300

运行后把鼠标移到目标区域左上角并按回车。脚本会记下这个 100×100 区域，
先等待你输入的秒数，再在其后 1～3 秒内随机选一个时刻，把鼠标移到区域内
的随机位置并单击。

紧急停止：把鼠标快速移到屏幕左上角（PyAutoGUI 安全保护），或按 Ctrl+C。
"""

from __future__ import annotations

import argparse
import random
import sys
import time
from dataclasses import dataclass

AREA_SIZE = 100
EXTRA_DELAY_MIN = 1.0
EXTRA_DELAY_MAX = 3.0


@dataclass(frozen=True)
class Point:
    x: int
    y: int


def parse_seconds(raw: str) -> float:
    """解析等待秒数。允许小数，不允许负数。"""
    text = raw.strip()
    if not text:
        raise ValueError("请输入等待秒数，例如 20")
    try:
        value = float(text)
    except ValueError as exc:
        raise ValueError(f"无法识别的秒数: {raw!r}，请输入数字，例如 20") from exc
    if value < 0:
        raise ValueError("等待秒数不能为负数")
    return value


def extra_delay(rng: random.Random | None = None) -> float:
    """在 1～3 秒之间均匀随机取一个额外等待时间。"""
    chooser = rng if rng is not None else random
    return chooser.uniform(EXTRA_DELAY_MIN, EXTRA_DELAY_MAX)


def random_point(
    origin_x: int,
    origin_y: int,
    screen_width: int,
    screen_height: int,
    size: int = AREA_SIZE,
    rng: random.Random | None = None,
) -> Point:
    """在以 (origin_x, origin_y) 为左上角的正方形内取随机整数坐标。

    区域超出屏幕时会被裁到屏幕内，保证点击点始终可见。
    """
    chooser = rng if rng is not None else random
    if size <= 0:
        raise ValueError("区域边长必须大于 0")
    if screen_width <= 0 or screen_height <= 0:
        raise ValueError("屏幕尺寸无效")

    min_x = min(max(origin_x, 0), screen_width - 1)
    min_y = min(max(origin_y, 0), screen_height - 1)
    max_x = min(origin_x + size - 1, screen_width - 1)
    max_y = min(origin_y + size - 1, screen_height - 1)
    max_x = max(max_x, min_x)
    max_y = max(max_y, min_y)
    return Point(chooser.randint(min_x, max_x), chooser.randint(min_y, max_y))


def click_deadline(base_seconds: float, now: float, rng: random.Random | None = None) -> tuple[float, float]:
    """返回 (额外等待秒数, 绝对截止时间)。截止时间 = now + base + 1～3 秒。"""
    extra = extra_delay(rng)
    return extra, now + base_seconds + extra


def prompt_seconds(preset: str | None) -> float:
    if preset is not None:
        return parse_seconds(preset)
    while True:
        raw = input("请输入等待秒数（例如 20）: ")
        try:
            return parse_seconds(raw)
        except ValueError as exc:
            print(exc)


def load_pyautogui():
    try:
        import pyautogui
    except ImportError:
        print("缺少依赖，请先安装: pip install -r requirements.txt", file=sys.stderr)
        raise SystemExit(1) from None
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0
    return pyautogui


def read_origin(pyautogui, origin: tuple[int, int] | None) -> Point:
    if origin is not None:
        return Point(origin[0], origin[1])
    input(
        "请把鼠标移到 100×100 区域的左上角，就位后按回车开始计时: "
    )
    pos = pyautogui.position()
    return Point(int(pos.x), int(pos.y))


def wait_until(deadline: float, clock=time.monotonic, sleep=time.sleep) -> None:
    """睡到截止时间，并每秒刷新一次剩余时间。"""
    while True:
        remaining = deadline - clock()
        if remaining <= 0:
            break
        print(f"\r距离点击还有 {remaining:5.1f} 秒", end="", flush=True)
        sleep(min(0.2, remaining))
    print()


def perform_click(pyautogui, point: Point) -> None:
    pyautogui.moveTo(point.x, point.y, duration=0)
    pyautogui.click(point.x, point.y)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="在 100×100 区域内随机位置点击。先等待你输入的秒数，再在其后 1～3 秒内随机点击。"
    )
    parser.add_argument(
        "seconds",
        nargs="?",
        help="基础等待秒数，例如 20。省略时会在运行中询问。",
    )
    parser.add_argument(
        "--origin",
        nargs=2,
        type=int,
        metavar=("X", "Y"),
        help="100×100 区域左上角坐标。省略时用回车确认当前鼠标位置。",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只打印计划中的坐标和等待时间，不移动鼠标、不点击。",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="随机种子，仅用于复现同一次随机结果。",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    rng = random.Random(args.seed) if args.seed is not None else None

    try:
        base_seconds = prompt_seconds(args.seconds)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 2

    origin_arg = tuple(args.origin) if args.origin is not None else None
    if args.dry_run and origin_arg is None:
        print("演练模式需要用 --origin X Y 指定区域左上角。", file=sys.stderr)
        return 2

    pyautogui = None if args.dry_run else load_pyautogui()
    if pyautogui is None:
        screen = Point(10_000, 10_000)
        origin = Point(origin_arg[0], origin_arg[1])
    else:
        width, height = pyautogui.size()
        screen = Point(int(width), int(height))
        origin = read_origin(pyautogui, origin_arg)

    point = random_point(origin.x, origin.y, screen.x, screen.y, rng=rng)
    extra, deadline = click_deadline(base_seconds, time.monotonic(), rng=rng)

    print(
        f"区域左上角 ({origin.x}, {origin.y})，范围 {AREA_SIZE}×{AREA_SIZE}。"
    )
    print(
        f"将先等待 {base_seconds:g} 秒，再额外随机等待 {extra:.2f} 秒"
        f"（合计 {base_seconds + extra:.2f} 秒）后点击 ({point.x}, {point.y})。"
    )
    print("取消：Ctrl+C。若已开始移动鼠标，也可把鼠标甩到屏幕左上角紧急停止。")

    if args.dry_run:
        print("演练模式：未移动鼠标，未点击。")
        return 0

    try:
        wait_until(deadline)
        perform_click(pyautogui, point)
    except KeyboardInterrupt:
        print("\n已取消。")
        return 130
    except Exception as exc:
        name = type(exc).__name__
        if name == "FailSafeException":
            print("\n已触发安全保护，停止点击。")
            return 1
        raise

    print(f"已点击 ({point.x}, {point.y})。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
