"""Xác minh hash tài khoản DEMO bằng Python 3, không cần thư viện ngoài."""
import base64
import getpass
import hashlib
import hmac
import re
import sys
from pathlib import Path


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, n, r, p, salt, expected = encoded.split('$')
        if algorithm != 'scrypt':
            return False
        # File demo do hệ thống tạo; chỉ chấp nhận đúng cấu hình demo.
        if (int(n), int(r), int(p)) != (131072, 8, 1):
            return False
        salt_bytes = base64.b64decode(salt, validate=True)
        expected_bytes = base64.b64decode(expected, validate=True)
        actual = hashlib.scrypt(password.encode('utf-8'), salt=salt_bytes,
                                n=131072, r=8, p=1, dklen=len(expected_bytes),
                                maxmem=256 * 1024 * 1024)
        return hmac.compare_digest(actual, expected_bytes)
    except (ValueError, TypeError):
        return False


if __name__ == '__main__':
    username = sys.argv[1] if len(sys.argv) > 1 else 'khach01'
    sql = Path(__file__).with_name('03_demo_data.sql').read_text(encoding='utf-8')
    match = re.search(r"\(\d+,'" + re.escape(username) + r"','([^']+)'", sql)
    if not match:
        raise SystemExit('Không có tài khoản này trong file demo.')
    password = getpass.getpass('Mật khẩu demo: ')
    print('Mật khẩu khớp.' if verify_password(password, match.group(1)) else 'Mật khẩu không khớp.')
    print('Backend còn phải kiểm tra trạng thái active và vai trò trước khi cấp phiên.')
