<?php
declare(strict_types=1);

namespace App;

use PDO;

final class CustomerController
{
    public function __construct(private readonly PDO $db) {}

    public function handle(string $method, string $path): bool
    {
        if ($method === 'GET' && $path === '/catalogs/options') {
            Http::json(200, $this->catalogOptions());
        }
        if ($method === 'POST' && $path === '/auth/register') {
            $this->register(Http::body());
        }
        if ($method === 'POST' && $path === '/auth/login') {
            $this->login(Http::body());
        }
        if (!str_starts_with($path, '/me')) {
            return false;
        }

        $account = $this->authenticatedCustomer();
        $customerId = (int) $account['id'];

        if ($method === 'GET' && $path === '/me') {
            Http::json(200, ['profile' => $this->profile($customerId)]);
        }
        if ($method === 'PATCH' && $path === '/me') {
            $this->updateProfile($customerId, Http::body());
        }
        if ($method === 'GET' && $path === '/me/feedback') {
            Http::json(200, ['feedback' => $this->feedbackHistory($customerId)]);
        }
        if ($method === 'POST' && $path === '/me/feedback') {
            $this->createFeedback($customerId, Http::body());
        }
        if ($method === 'GET' && $path === '/me/surveys') {
            Http::json(200, ['surveys' => $this->surveys($customerId)]);
        }
        if ($method === 'GET' && preg_match('#^/me/surveys/(\d+)$#', $path, $matches)) {
            $this->survey($customerId, (int) $matches[1]);
        }
        if ($method === 'POST' && preg_match('#^/me/surveys/(\d+)/submit$#', $path, $matches)) {
            $this->submitSurvey($customerId, (int) $matches[1], Http::body());
        }
        if ($method === 'GET' && $path === '/me/notifications') {
            Http::json(200, ['notifications' => $this->notifications($customerId)]);
        }
        if ($method === 'PATCH' && preg_match('#^/me/notifications/(\d+)$#', $path, $matches)) {
            $statement = $this->db->prepare('UPDATE thong_bao SET da_doc=true,ngay_doc=coalesce(ngay_doc,clock_timestamp()) WHERE id=:notification AND tai_khoan_id=:customer');
            $statement->execute(['notification' => (int) $matches[1], 'customer' => $customerId]);
            Http::json(200, ['message' => 'Đã đọc thông báo']);
        }
        return false;
    }

    private function notifications(int $customerId): array
    {
        $statement = $this->db->prepare('SELECT id,loai AS type,tieu_de AS title,noi_dung AS content,lien_ket AS link,da_doc AS read,ngay_tao AS "createdAt" FROM thong_bao WHERE tai_khoan_id=:customer ORDER BY ngay_tao DESC,id DESC LIMIT 50');
        $statement->execute(['customer' => $customerId]);
        return $statement->fetchAll();
    }

    private function catalogOptions(): array
    {
        return [
            'preferences' => $this->db->query('SELECT id, ten_nhom AS "tenNhom" FROM nhom_so_thich WHERE dang_su_dung ORDER BY ten_nhom')->fetchAll(),
            'drinks' => $this->db->query('SELECT id, ma_do_uong AS "maDoUong", ten_do_uong AS "tenDoUong" FROM do_uong WHERE dang_kinh_doanh ORDER BY ten_do_uong')->fetchAll(),
        ];
    }

    private function register(array $body): never
    {
        $this->validateProfile($body);
        $username = trim((string) ($body['tenDangNhap'] ?? ''));
        Http::require((bool) preg_match('/^[a-zA-Z0-9._-]{3,100}$/', $username), 'Tên đăng nhập phải có 3–100 ký tự và không chứa khoảng trắng');
        $hash = Auth::hashPassword((string) ($body['matKhau'] ?? ''));

        $this->db->beginTransaction();
        try {
            $statement = $this->db->prepare(<<<'SQL'
                WITH tk AS (
                    INSERT INTO tai_khoan(ten_dang_nhap, mat_khau_hash, vai_tro)
                    VALUES (:username, :password_hash, 'customer') RETURNING id
                )
                INSERT INTO khach_hang(tai_khoan_id, ma_thanh_vien, ho_ten, nam_sinh, gioi_tinh, so_thich_id)
                SELECT id, 'TV' || lpad(id::text, 6, '0'), :full_name, :birth_year, :gender, :preference_id FROM tk
                RETURNING tai_khoan_id
            SQL);
            $statement->execute([
                'username' => $username,
                'password_hash' => $hash,
                'full_name' => trim((string) $body['hoTen']),
                'birth_year' => (int) $body['namSinh'],
                'gender' => $body['gioiTinh'] ?? 'khong_cung_cap',
                'preference_id' => (int) $body['soThichId'],
            ]);
            $customerId = (int) $statement->fetchColumn();
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }

        Http::json(201, [
            'token' => Auth::createToken(['id' => $customerId, 'vai_tro' => 'customer']),
            'profile' => $this->profile($customerId),
        ]);
    }

    private function login(array $body): never
    {
        $username = trim((string) ($body['tenDangNhap'] ?? ''));
        $password = (string) ($body['matKhau'] ?? '');
        Http::require($username !== '' && $password !== '', 'Vui lòng nhập tên đăng nhập và mật khẩu');
        $statement = $this->db->prepare('SELECT id, ten_dang_nhap, mat_khau_hash, vai_tro, trang_thai FROM tai_khoan WHERE ten_dang_nhap=lower(btrim(:username))');
        $statement->execute(['username' => $username]);
        $account = $statement->fetch();
        if (!$account || !Auth::verifyPassword($password, $account['mat_khau_hash'])) {
            throw new ApiException(401, 'INVALID_CREDENTIALS', 'Tên đăng nhập hoặc mật khẩu không đúng');
        }
        if ($account['trang_thai'] !== 'active') {
            throw new ApiException(403, 'ACCOUNT_LOCKED', 'Tài khoản đã bị khóa, vui lòng liên hệ hỗ trợ');
        }
        if ($account['vai_tro'] !== 'customer') {
            throw new ApiException(403, 'WRONG_PORTAL', 'Vui lòng đăng nhập tại khu vực nội bộ');
        }
        Http::json(200, ['token' => Auth::createToken($account), 'profile' => $this->profile((int) $account['id'])]);
    }

    private function authenticatedCustomer(): array
    {
        $payload = Auth::readToken(Http::bearerToken());
        if (!$payload) {
            throw new ApiException(401, 'UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn');
        }
        $statement = $this->db->prepare('SELECT id, ten_dang_nhap, vai_tro, trang_thai FROM tai_khoan WHERE id=:id');
        $statement->execute(['id' => (int) $payload['sub']]);
        $account = $statement->fetch();
        if (!$account || $account['trang_thai'] !== 'active') {
            throw new ApiException(401, 'ACCOUNT_INACTIVE', 'Tài khoản đã bị khóa hoặc không tồn tại');
        }
        if ($account['vai_tro'] !== 'customer') {
            throw new ApiException(403, 'FORBIDDEN', 'Chức năng chỉ dành cho khách hàng');
        }
        return $account;
    }

    private function profile(int $customerId): array
    {
        $statement = $this->db->prepare(<<<'SQL'
            SELECT t.id, t.ten_dang_nhap AS "tenDangNhap", t.trang_thai AS "trangThai", t.ngay_tao AS "ngayTao",
                   h.ma_thanh_vien AS "maThanhVien", h.ho_ten AS "hoTen", h.nam_sinh AS "namSinh",
                   h.gioi_tinh AS "gioiTinh", h.so_thich_id AS "soThichId", s.ten_nhom AS "soThich"
              FROM tai_khoan t JOIN khach_hang h ON h.tai_khoan_id=t.id
              JOIN nhom_so_thich s ON s.id=h.so_thich_id WHERE t.id=:id
        SQL);
        $statement->execute(['id' => $customerId]);
        $profile = $statement->fetch();
        if (!$profile) {
            throw new ApiException(404, 'PROFILE_NOT_FOUND', 'Không tìm thấy hồ sơ khách hàng');
        }
        return $profile;
    }

    private function updateProfile(int $customerId, array $body): never
    {
        $current = $this->profile($customerId);
        $body = array_merge($current, $body);
        $this->validateProfile($body);
        $statement = $this->db->prepare('UPDATE khach_hang SET ho_ten=:name,nam_sinh=:year,gioi_tinh=:gender,so_thich_id=:preference,ngay_cap_nhat=now() WHERE tai_khoan_id=:id');
        $statement->execute([
            'name' => trim((string) $body['hoTen']), 'year' => (int) $body['namSinh'],
            'gender' => $body['gioiTinh'], 'preference' => (int) $body['soThichId'], 'id' => $customerId,
        ]);
        Http::json(200, ['profile' => $this->profile($customerId)]);
    }

    private function validateProfile(array $body): void
    {
        $name = trim((string) ($body['hoTen'] ?? ''));
        $year = filter_var($body['namSinh'] ?? null, FILTER_VALIDATE_INT);
        $gender = $body['gioiTinh'] ?? 'khong_cung_cap';
        $preference = filter_var($body['soThichId'] ?? null, FILTER_VALIDATE_INT);
        Http::require(mb_strlen($name) >= 2 && mb_strlen($name) <= 150, 'Họ tên phải có từ 2 đến 150 ký tự');
        Http::require($year !== false && $year >= 1900 && $year <= (int) date('Y'), 'Năm sinh không hợp lệ');
        Http::require(in_array($gender, ['nam', 'nu', 'khac', 'khong_cung_cap'], true), 'Giới tính không hợp lệ');
        Http::require($preference !== false && $preference > 0, 'Vui lòng chọn nhóm sở thích');
    }

    private function feedbackHistory(int $customerId): array
    {
        $statement = $this->db->prepare(<<<'SQL'
            SELECT p.id,d.ten_do_uong AS "tenDoUong",p.so_sao AS "soSao",
                   p.noi_dung AS "noiDung",p.trang_thai AS "trangThai",p.ngay_gui AS "ngayGui",
                   p.phan_hoi_cua_nhan_vien AS "phanHoiCuaNhanVien",p.ngay_phan_hoi AS "ngayPhanHoi"
              FROM phan_hoi p JOIN do_uong d ON d.id=p.do_uong_id
             WHERE p.khach_hang_id=:id ORDER BY p.ngay_gui DESC,p.id DESC
        SQL);
        $statement->execute(['id' => $customerId]);
        return $statement->fetchAll();
    }

    private function createFeedback(int $customerId, array $body): never
    {
        $drink = filter_var($body['doUongId'] ?? null, FILTER_VALIDATE_INT);
        $rating = filter_var($body['soSao'] ?? null, FILTER_VALIDATE_INT);
        $content = trim((string) ($body['noiDung'] ?? ''));
        Http::require($drink !== false && $drink > 0, 'Vui lòng chọn đồ uống');
        Http::require($rating !== false && $rating >= 1 && $rating <= 5, 'Số sao phải từ 1 đến 5');
        Http::require(mb_strlen($content) >= 10, 'Nội dung phản hồi phải có ít nhất 10 ký tự');
        $this->db->beginTransaction();
        try {
            $lock = $this->db->prepare('SELECT pg_advisory_xact_lock(:customer)');
            $lock->execute(['customer' => $customerId]);
            $duplicate = $this->db->prepare(<<<'SQL'
                SELECT 1 FROM phan_hoi
                 WHERE khach_hang_id=:customer AND do_uong_id=:drink
                   AND so_sao=:rating AND noi_dung=:content
                   AND ngay_gui >= clock_timestamp() - interval '5 seconds'
                 LIMIT 1
            SQL);
            $duplicate->execute([
                'customer' => $customerId, 'drink' => $drink,
                'rating' => $rating, 'content' => $content,
            ]);
            if ($duplicate->fetchColumn()) {
                throw new ApiException(409, 'DUPLICATE_FEEDBACK', 'Phản hồi này vừa được gửi, vui lòng không gửi lại');
            }

            $statement = $this->db->prepare(<<<'SQL'
                INSERT INTO phan_hoi(khach_hang_id,do_uong_id,so_sao,noi_dung)
                VALUES (:customer,:drink,:rating,:content)
                RETURNING id,trang_thai AS "trangThai",ngay_gui AS "ngayGui"
            SQL);
            $statement->execute([
                'customer' => $customerId, 'drink' => $drink,
                'rating' => $rating, 'content' => $content,
            ]);
            $feedback = $statement->fetch();
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
        Http::json(201, ['feedback' => $feedback]);
    }

    private function surveys(int $customerId): array
    {
        $statement = $this->db->prepare(<<<'SQL'
            SELECT k.id,k.tieu_de AS "tieuDe",k.mo_ta AS "moTa",k.trang_thai AS "trangThai",
                   k.ngay_ket_thuc AS "ngayKetThuc",p.ngay_gui AS "ngayGui",p.ngay_hoan_thanh AS "ngayHoanThanh",
                   count(c.id)::int AS "soCauHoi"
              FROM phan_phoi_khao_sat p JOIN khao_sat k ON k.id=p.khao_sat_id LEFT JOIN cau_hoi c ON c.khao_sat_id=k.id
             WHERE p.khach_hang_id=:id AND NOT k.da_an GROUP BY k.id,p.ngay_gui,p.ngay_hoan_thanh ORDER BY p.ngay_gui DESC
        SQL);
        $statement->execute(['id' => $customerId]);
        return $statement->fetchAll();
    }

    private function survey(int $customerId, int $surveyId): never
    {
        $statement = $this->db->prepare(<<<'SQL'
            SELECT k.id,k.tieu_de AS "tieuDe",k.mo_ta AS "moTa",k.trang_thai AS "trangThai",
                   k.ngay_ket_thuc AS "ngayKetThuc",p.ngay_hoan_thanh AS "ngayHoanThanh",
                   coalesce(json_agg(json_build_object(
                     'id',c.id,'noiDung',c.noi_dung,'thuTu',c.thu_tu,'batBuoc',c.bat_buoc,
                     'luaChon',(SELECT json_agg(json_build_object('id',l.id,'noiDung',l.noi_dung,'thuTu',l.thu_tu) ORDER BY l.thu_tu) FROM lua_chon l WHERE l.cau_hoi_id=c.id)
                   ) ORDER BY c.thu_tu) FILTER (WHERE c.id IS NOT NULL),'[]') AS questions
              FROM phan_phoi_khao_sat p JOIN khao_sat k ON k.id=p.khao_sat_id LEFT JOIN cau_hoi c ON c.khao_sat_id=k.id
             WHERE p.khach_hang_id=:customer AND k.id=:survey AND NOT k.da_an GROUP BY k.id,p.ngay_hoan_thanh
        SQL);
        $statement->execute(['customer' => $customerId, 'survey' => $surveyId]);
        $survey = $statement->fetch();
        if (!$survey) {
            throw new ApiException(404, 'SURVEY_NOT_FOUND', 'Khảo sát không tồn tại hoặc chưa được gửi cho bạn');
        }
        $survey['questions'] = json_decode((string) $survey['questions'], true, 512, JSON_THROW_ON_ERROR);
        Http::json(200, ['survey' => $survey]);
    }

    private function submitSurvey(int $customerId, int $surveyId, array $body): never
    {
        $answers = $body['answers'] ?? null;
        Http::require(is_array($answers) && $answers !== [], 'Vui lòng trả lời khảo sát');
        $normalized = [];
        foreach ($answers as $answer) {
            $question = filter_var($answer['cauHoiId'] ?? null, FILTER_VALIDATE_INT);
            $choice = filter_var($answer['luaChonId'] ?? null, FILTER_VALIDATE_INT);
            Http::require($question !== false && $choice !== false, 'Câu trả lời không hợp lệ');
            $normalized[] = ['cau_hoi_id' => $question, 'lua_chon_id' => $choice];
        }
        $statement = $this->db->prepare('SELECT crm_nop_khao_sat(:customer,:survey,CAST(:answers AS jsonb))');
        $statement->execute(['customer' => $customerId, 'survey' => $surveyId, 'answers' => json_encode($normalized, JSON_THROW_ON_ERROR)]);
        Http::json(200, ['message' => 'Nộp khảo sát thành công']);
    }
}
