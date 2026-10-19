<?php
declare(strict_types=1);

namespace App;

use PDOException;
use Throwable;

final class Http
{
    public static function json(int $status, array $data): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function body(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || strlen($raw) > 262144) {
            throw new ApiException(413, 'PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên quá lớn');
        }
        if ($raw === '') {
            return [];
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            throw new ApiException(400, 'INVALID_JSON', 'JSON không hợp lệ');
        }
        return $data;
    }

    public static function require(bool $condition, string $message, string $code = 'INVALID_INPUT'): void
    {
        if (!$condition) {
            throw new ApiException(400, $code, $message);
        }
    }

    public static function bearerToken(): string
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        return str_starts_with($header, 'Bearer ') ? substr($header, 7) : '';
    }

    public static function error(Throwable $error): never
    {
        error_log($error->getMessage());
        if ($error instanceof ApiException) {
            self::json($error->status, ['code' => $error->errorCode, 'message' => $error->getMessage()]);
        }
        if ($error instanceof PDOException) {
            $state = $error->errorInfo[0] ?? $error->getCode();
            if ($state === '23505') {
                self::json(409, ['code' => 'DUPLICATE_DATA', 'message' => 'Tên đăng nhập hoặc mã thành viên đã tồn tại']);
            }
            if (in_array($state, ['23503', '23514', '22P02', 'P0001'], true)) {
                self::json(400, ['code' => 'BUSINESS_RULE', 'message' => $error->getMessage()]);
            }
        }
        self::json(500, ['code' => 'INTERNAL_ERROR', 'message' => 'Hệ thống đang bận, vui lòng thử lại']);
    }
}
