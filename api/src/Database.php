<?php
declare(strict_types=1);

namespace App;

use PDO;

final class Database
{
    private static ?PDO $connection = null;

    public static function pdo(): PDO
    {
        if (self::$connection === null) {
            self::$connection = new PDO(
                Config::get('DB_DSN', 'pgsql:host=127.0.0.1;port=5432;dbname=crm_tra_sua_ca_phe'),
                Config::get('DB_USER', 'postgres'),
                Config::get('DB_PASSWORD'),
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES => false,
                ]
            );
            self::$connection->exec("SET TIME ZONE 'Asia/Ho_Chi_Minh'");
        }
        return self::$connection;
    }
}
