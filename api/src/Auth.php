<?php
declare(strict_types=1);

namespace App;

final class Auth
{
    public static function hashPassword(string $password): string
    {
        Http::require(strlen($password) >= 8 && strlen($password) <= 128, 'Mật khẩu phải có từ 8 đến 128 ký tự', 'INVALID_PASSWORD');
        return password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
    }

    public static function verifyPassword(string $password, string $hash): bool
    {
        return password_verify($password, $hash);
    }

    public static function createToken(array $account): string
    {
        $payload = self::base64UrlEncode(json_encode([
            'sub' => (int) $account['id'],
            'role' => $account['vai_tro'],
            'exp' => time() + 8 * 60 * 60,
        ], JSON_THROW_ON_ERROR));
        return $payload . '.' . self::signature($payload);
    }

    public static function readToken(string $token): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 2 || !hash_equals(self::signature($parts[0]), $parts[1])) {
            return null;
        }
        try {
            $payload = json_decode(self::base64UrlDecode($parts[0]), true, 16, JSON_THROW_ON_ERROR);
            return ($payload['exp'] ?? 0) > time() ? $payload : null;
        } catch (\JsonException) {
            return null;
        }
    }

    private static function signature(string $payload): string
    {
        return self::base64UrlEncode(hash_hmac('sha256', $payload, Config::get('AUTH_SECRET'), true));
    }

    private static function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $value): string
    {
        return (string) base64_decode(strtr($value, '-_', '+/'), true);
    }
}
