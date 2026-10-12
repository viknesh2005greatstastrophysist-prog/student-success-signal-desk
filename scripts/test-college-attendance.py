import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("college_import", Path(__file__).with_name("import-college-attendance.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AttendanceValueTests(unittest.TestCase):
    def test_zero_is_a_number_not_missing(self):
        self.assertEqual(module.classify(0), ("number", 0.0, None))

    def test_statuses_and_blank_stay_distinct(self):
        self.assertEqual(module.classify("NA"), ("source_status", None, "NA"))
        self.assertEqual(module.classify("TNS"), ("source_status", None, "TNS"))
        self.assertEqual(module.classify(""), ("blank", None, None))

    def test_do_not_parse_numeric_text_or_unknown_status_as_attendance(self):
        for value in ["75", "75%", "Absent", True, -1, 101, float("nan"), float("inf")]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.classify(value)

    def test_raw_percent_like_number_is_not_scaled(self):
        self.assertEqual(module.classify(79), ("number", 79.0, None))
        self.assertEqual(module.classify(0.79), ("number", 0.79, None))


if __name__ == "__main__":
    unittest.main()
