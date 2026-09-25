"""random_click 的纯逻辑测试，不依赖显示器和真实鼠标。"""

import random
import unittest

from random_click import (
    AREA_SIZE,
    EXTRA_DELAY_MAX,
    EXTRA_DELAY_MIN,
    click_deadline,
    extra_delay,
    parse_seconds,
    random_point,
)


class ParseSecondsTest(unittest.TestCase):
    def test_integer_and_decimal(self):
        self.assertEqual(parse_seconds("20"), 20.0)
        self.assertEqual(parse_seconds(" 1.5 "), 1.5)
        self.assertEqual(parse_seconds("0"), 0.0)

    def test_rejects_invalid(self):
        for raw in ("", "   ", "abc", "-1", "-0.1"):
            with self.assertRaises(ValueError):
                parse_seconds(raw)


class ExtraDelayTest(unittest.TestCase):
    def test_stays_inside_one_to_three_seconds(self):
        rng = random.Random(0)
        samples = [extra_delay(rng) for _ in range(200)]
        self.assertTrue(all(EXTRA_DELAY_MIN <= value <= EXTRA_DELAY_MAX for value in samples))
        self.assertGreater(max(samples) - min(samples), 1.0)

    def test_deadline_adds_base_and_extra(self):
        rng = random.Random(1)
        extra, deadline = click_deadline(20, now=100.0, rng=rng)
        self.assertGreaterEqual(extra, EXTRA_DELAY_MIN)
        self.assertLessEqual(extra, EXTRA_DELAY_MAX)
        self.assertAlmostEqual(deadline, 100.0 + 20 + extra)


class RandomPointTest(unittest.TestCase):
    def test_point_stays_inside_area_and_screen(self):
        rng = random.Random(2)
        origin_x, origin_y = 400, 300
        width, height = 1920, 1080
        for _ in range(300):
            point = random_point(origin_x, origin_y, width, height, rng=rng)
            self.assertGreaterEqual(point.x, origin_x)
            self.assertLess(point.x, origin_x + AREA_SIZE)
            self.assertGreaterEqual(point.y, origin_y)
            self.assertLess(point.y, origin_y + AREA_SIZE)

    def test_clamps_to_screen_edges(self):
        rng = random.Random(3)
        for _ in range(50):
            point = random_point(1900, 1050, 1920, 1080, rng=rng)
            self.assertGreaterEqual(point.x, 1900)
            self.assertLessEqual(point.x, 1919)
            self.assertGreaterEqual(point.y, 1050)
            self.assertLessEqual(point.y, 1079)

    def test_origin_outside_screen_is_pulled_back(self):
        point = random_point(-20, -5, 800, 600, rng=random.Random(4))
        self.assertGreaterEqual(point.x, 0)
        self.assertGreaterEqual(point.y, 0)
        self.assertLess(point.x, AREA_SIZE)
        self.assertLess(point.y, AREA_SIZE)


if __name__ == "__main__":
    unittest.main()
