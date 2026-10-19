<?php
declare(strict_types=1);

namespace App;

use PDO;

final class InternalController
{
    public function __construct(private readonly PDO $db) {}

    public function handle(string $method, string $path): bool
    {
        if ($method === 'POST' && $path === '/internal/auth/login') {
            $this->login(Http::body());
        }
        if (!str_starts_with($path, '/internal')) {
            return false;
        }

        $account = $this->authenticatedAccount();
        if ($method === 'GET' && $path === '/internal/me') {
            Http::json(200, ['account' => $account]);
        }
        if ($method === 'GET' && $path === '/internal/dashboard') {
            Http::json(200, $this->dashboard());
        }
        if ($method === 'GET' && $path === '/internal/customers') {
            Http::json(200, ['customers' => $this->customers()]);
        }
        if ($method === 'POST' && $path === '/internal/customers') {
            $this->createCustomer((int) $account['id'], Http::body());
        }
        if ($method === 'PATCH' && preg_match('#^/internal/customers/(\d+)/status$#', $path, $matches)) {
            $this->updateCustomerStatus((int) $account['id'], (int) $matches[1], Http::body());
        }
        if ($method === 'GET' && $path === '/internal/reports/customers') {
            Http::json(200, $this->customerReports());
        }
        if ($method === 'GET' && $path === '/internal/feedback') {
            Http::json(200, ['feedback' => $this->feedback()]);
        }
        if ($method === 'PATCH' && preg_match('#^/internal/feedback/(\d+)$#', $path, $matches)) {
            $this->updateFeedback((int) $account['id'], (int) $matches[1], Http::body());
        }
        if ($method === 'GET' && $path === '/internal/surveys') {
            Http::json(200, ['surveys' => $this->surveys()]);
        }
        if ($method === 'GET' && preg_match('#^/internal/surveys/(\d+)/results$#', $path, $matches)) {
            Http::json(200, $this->surveyResults((int) $matches[1]));
        }
        if ($method === 'GET' && preg_match('#^/internal/surveys/(\d+)$#', $path, $matches)) {
            Http::json(200, ['survey' => $this->surveyDetails((int) $matches[1])]);
        }
        if ($method === 'PATCH' && preg_match('#^/internal/surveys/(\d+)/visibility$#', $path, $matches)) {
            $this->setSurveyVisibility((int) $matches[1], Http::body());
        }
        if ($method === 'PATCH' && preg_match('#^/internal/surveys/(\d+)$#', $path, $matches)) {
            $this->updateSurvey((int) $matches[1], Http::body());
        }
        if ($method === 'POST' && $path === '/internal/surveys') {
            $this->createSurvey((int) $account['id'], Http::body());
        }
        if ($method === 'GET' && $path === '/internal/accounts') {
            $this->requireAdmin($account);
            Http::json(200, ['accounts' => $this->accounts()]);
        }
        if ($method === 'PATCH' && preg_match('#^/internal/customers/(\d+)$#', $path, $matches)) {
            $this->updateCustomerProfile((int) $account['id'], (int) $matches[1], Http::body(), $account['role']);
        }
        if ($method === 'GET' && $path === '/internal/customer-requests') {
            Http::json(200, ['requests' => $this->customerRequests($account)]);
        }
        if ($method === 'POST' && $path === '/internal/customer-requests') {
            $this->createCustomerRequest((int) $account['id'], Http::body(), $account['role']);
        }
        if ($method === 'PATCH' && preg_match('#^/internal/customer-requests/(\d+)$#', $path, $matches)) {
            $this->requireAdmin($account);
            $this->decideCustomerRequest((int) $account['id'], (int) $matches[1], Http::body());
        }
        if ($method === 'GET' && $path === '/internal/managers') {
            $this->requireAdmin($account);
            Http::json(200, ['managers' => $this->managers()]);
        }
        if ($method === 'POST' && $path === '/internal/managers') {
            $this->requireAdmin($account);
            $this->createManager((int) $account['id'], Http::body());
        }
        if ($method === 'PATCH' && preg_match('#^/internal/managers/(\d+)$#', $path, $matches)) {
            $this->requireAdmin($account);
            $this->updateManager((int) $matches[1], Http::body());
        }
        if ($method === 'GET' && $path === '/internal/catalogs') {
            Http::json(200, $this->catalogs());
        }
        return false;
    }

    private function login(array $body): never
    {
        $username = trim((string) ($body['tenDangNhap'] ?? ''));
        $password = (string) ($body['matKhau'] ?? '');
        Http::require($username !== '' && $password !== '', 'Vui lòng nhập tên đăng nhập và mật khẩu');
        $statement = $this->db->prepare(<<<'SQL'
            SELECT t.id,t.ten_dang_nhap,t.mat_khau_hash,t.vai_tro,t.trang_thai
              FROM tai_khoan t
             WHERE t.ten_dang_nhap=lower(btrim(:username))
        SQL);
        $statement->execute(['username' => $username]);
        $account = $statement->fetch();
        if (!$account || !Auth::verifyPassword($password, $account['mat_khau_hash'])) {
            throw new ApiException(401, 'INVALID_CREDENTIALS', 'Tên đăng nhập hoặc mật khẩu không đúng');
        }
        if ($account['trang_thai'] !== 'active') {
            throw new ApiException(403, 'ACCOUNT_LOCKED', 'Tài khoản đã bị khóa');
        }
        if (!in_array($account['vai_tro'], ['admin', 'manager'], true)) {
            throw new ApiException(403, 'WRONG_PORTAL', 'Tài khoản không có quyền truy cập Admin/Manager');
        }
        $token = Auth::createToken($account);
        Http::json(200, ['token' => $token, 'account' => [
            'id' => $account['id'], 'tenDangNhap' => $account['ten_dang_nhap'], 'role' => $account['vai_tro'],
            'status' => $account['trang_thai'],
        ]]);
    }

    private function authenticatedAccount(): array
    {
        $payload = Auth::readToken(Http::bearerToken());
        if (!$payload) {
            throw new ApiException(401, 'UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn');
        }
        $statement = $this->db->prepare(<<<'SQL'
            SELECT t.id,t.ten_dang_nhap AS "tenDangNhap",t.vai_tro AS role,t.trang_thai AS status
              FROM tai_khoan t WHERE t.id=:id
        SQL);
        $statement->execute(['id' => (int) $payload['sub']]);
        $account = $statement->fetch();
        if (!$account || $account['status'] !== 'active') {
            throw new ApiException(401, 'ACCOUNT_INACTIVE', 'Tài khoản đã bị khóa hoặc không tồn tại');
        }
        if (!in_array($account['role'], ['admin', 'manager'], true)) {
            throw new ApiException(403, 'FORBIDDEN', 'Chức năng chỉ dành cho Admin và Manager');
        }
        return $account;
    }

    private function requireAdmin(array $account): void
    {
        if ($account['role'] !== 'admin') {
            throw new ApiException(403, 'FORBIDDEN', 'Chức năng chỉ dành cho Admin');
        }
    }

    private function dashboard(): array
    {
        $summary = $this->db->query(<<<'SQL'
            SELECT count(*)::int AS "totalCustomers",
                   count(*) FILTER (WHERE t.trang_thai='active')::int AS "activeCustomers",
                   (SELECT count(*)::int FROM phan_hoi) AS "totalFeedback",
                   (SELECT count(*)::int FROM phan_hoi WHERE trang_thai='moi') AS "newFeedback",
                   (SELECT coalesce(round(avg(so_sao),2),0) FROM phan_hoi) AS "averageRating",
                   (SELECT count(*)::int FROM khao_sat) AS "totalSurveys",
                   (SELECT count(*)::int FROM tai_khoan) AS "totalAccounts",
                   (SELECT count(*)::int FROM tai_khoan WHERE vai_tro<>'customer') AS "internalAccounts"
              FROM khach_hang h JOIN tai_khoan t ON t.id=h.tai_khoan_id
        SQL)->fetch();
        $recent = $this->db->query(<<<'SQL'
            SELECT h.tai_khoan_id AS id,h.ho_ten AS name,h.ma_thanh_vien AS code,
                   extract(year FROM current_date)::int-h.nam_sinh AS age,s.ten_nhom AS preference,
                   t.trang_thai AS status,h.ngay_cap_nhat AS "updatedAt"
              FROM khach_hang h JOIN tai_khoan t ON t.id=h.tai_khoan_id
              JOIN nhom_so_thich s ON s.id=h.so_thich_id
             ORDER BY h.ngay_cap_nhat DESC,h.tai_khoan_id DESC LIMIT 5
        SQL)->fetchAll();
        return ['summary' => $summary, 'recentCustomers' => $recent];
    }

    private function customers(): array
    {
        return $this->db->query(<<<'SQL'
            SELECT h.tai_khoan_id AS id,h.ho_ten AS name,h.ma_thanh_vien AS code,t.ten_dang_nhap AS username,
                   h.nam_sinh AS "birthYear",h.gioi_tinh AS gender,extract(year FROM current_date)::int-h.nam_sinh AS age,
                   h.so_thich_id AS "preferenceId",s.ten_nhom AS preference,
                   t.trang_thai AS status,h.ngay_cap_nhat AS "updatedAt"
              FROM khach_hang h JOIN tai_khoan t ON t.id=h.tai_khoan_id
              JOIN nhom_so_thich s ON s.id=h.so_thich_id
             ORDER BY h.ngay_cap_nhat DESC,h.tai_khoan_id DESC
        SQL)->fetchAll();
    }

    private function createCustomer(int $accountId, array $body): never
    {
        $username = trim((string) ($body['tenDangNhap'] ?? ''));
        $password = (string) ($body['matKhau'] ?? '');
        $name = trim((string) ($body['hoTen'] ?? ''));
        $birthYear = filter_var($body['namSinh'] ?? null, FILTER_VALIDATE_INT);
        $gender = (string) ($body['gioiTinh'] ?? 'khong_cung_cap');
        $preferenceId = filter_var($body['soThichId'] ?? null, FILTER_VALIDATE_INT);

        Http::require((bool) preg_match('/^[a-zA-Z0-9._-]{3,100}$/', $username), 'Tên đăng nhập phải có 3–100 ký tự và không chứa khoảng trắng');
        Http::require(strlen($password) >= 8 && strlen($password) <= 128, 'Mật khẩu phải có từ 8 đến 128 ký tự');
        Http::require(mb_strlen($name) >= 2 && mb_strlen($name) <= 150, 'Họ tên phải có từ 2 đến 150 ký tự');
        Http::require($birthYear !== false && $birthYear >= 1900 && $birthYear <= (int) date('Y'), 'Năm sinh không hợp lệ');
        Http::require(in_array($gender, ['nam', 'nu', 'khac', 'khong_cung_cap'], true), 'Giới tính không hợp lệ');
        Http::require($preferenceId !== false && $preferenceId > 0, 'Vui lòng chọn nhóm sở thích');
        $preference = $this->db->prepare('SELECT 1 FROM nhom_so_thich WHERE id=:id AND dang_su_dung');
        $preference->execute(['id' => $preferenceId]);
        Http::require((bool) $preference->fetchColumn(), 'Nhóm sở thích không tồn tại hoặc đã ngừng sử dụng');

        $this->db->beginTransaction();
        try {
            $statement = $this->db->prepare(<<<'SQL'
                WITH tk AS (
                    INSERT INTO tai_khoan(ten_dang_nhap,mat_khau_hash,vai_tro,nguoi_tao_id)
                    VALUES (:username,:password_hash,'customer',:account) RETURNING id
                )
                INSERT INTO khach_hang(tai_khoan_id,ma_thanh_vien,ho_ten,nam_sinh,gioi_tinh,so_thich_id)
                SELECT id,'TV'||lpad(id::text,6,'0'),:name,:birth_year,CAST(:gender AS gioi_tinh),:preference_id FROM tk
                RETURNING tai_khoan_id
            SQL);
            $statement->execute([
                'username' => $username,
                'password_hash' => Auth::hashPassword($password),
                'account' => $accountId,
                'name' => $name,
                'birth_year' => $birthYear,
                'gender' => $gender,
                'preference_id' => $preferenceId,
            ]);
            $customerId = (int) $statement->fetchColumn();
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }

        Http::json(201, ['customer' => $this->customerById($customerId)]);
    }

    private function updateCustomerStatus(int $accountId, int $customerId, array $body): never
    {
        $status = (string) ($body['status'] ?? '');
        Http::require(in_array($status, ['active', 'locked'], true), 'Trạng thái tài khoản không hợp lệ');
        $statement = $this->db->prepare('SELECT crm_dat_trang_thai_khach_hang(:account,:customer,CAST(:status AS trang_thai_tai_khoan))');
        $statement->execute([
            'account' => $accountId,
            'customer' => $customerId,
            'status' => $status,
        ]);
        Http::json(200, ['customer' => $this->customerById($customerId)]);
    }

    private function customerById(int $customerId): array
    {
        $statement = $this->db->prepare(<<<'SQL'
            SELECT h.tai_khoan_id AS id,h.ho_ten AS name,h.ma_thanh_vien AS code,t.ten_dang_nhap AS username,
                   h.nam_sinh AS "birthYear",h.gioi_tinh AS gender,
                   extract(year FROM current_date)::int-h.nam_sinh AS age,
                   h.so_thich_id AS "preferenceId",s.ten_nhom AS preference,
                   t.trang_thai AS status,h.ngay_cap_nhat AS "updatedAt"
              FROM khach_hang h JOIN tai_khoan t ON t.id=h.tai_khoan_id
              JOIN nhom_so_thich s ON s.id=h.so_thich_id
             WHERE h.tai_khoan_id=:id
        SQL);
        $statement->execute(['id' => $customerId]);
        $customer = $statement->fetch();
        if (!$customer) {
            throw new ApiException(404, 'CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng');
        }
        return $customer;
    }

    private function customerReports(): array
    {
        return [
            'ages' => $this->db->query('SELECT nhom_tuoi AS label,so_khach_hang AS count,ty_le_phan_tram AS percentage FROM v_bao_cao_do_tuoi ORDER BY thu_tu')->fetchAll(),
            'preferences' => $this->db->query('SELECT ten_nhom AS label,so_khach_hang AS count,ty_le_phan_tram AS percentage FROM v_bao_cao_so_thich ORDER BY id')->fetchAll(),
        ];
    }

    private function feedback(): array
    {
        return $this->db->query(<<<'SQL'
            SELECT p.id,h.ho_ten AS "customerName",h.ma_thanh_vien AS "memberCode",d.ten_do_uong AS "drinkName",
                   p.so_sao AS rating,p.noi_dung AS content,
                   p.trang_thai AS status,p.ngay_gui AS "sentAt",p.ngay_xu_ly AS "handledAt",
                   p.phan_hoi_cua_nhan_vien AS reply,p.ngay_phan_hoi AS "repliedAt"
              FROM phan_hoi p JOIN khach_hang h ON h.tai_khoan_id=p.khach_hang_id
              JOIN do_uong d ON d.id=p.do_uong_id
             ORDER BY p.ngay_gui DESC,p.id DESC
        SQL)->fetchAll();
    }

    private function updateFeedback(int $accountId, int $feedbackId, array $body): never
    {
        $status = (string) ($body['status'] ?? '');
        $reply = trim((string) ($body['reply'] ?? ''));
        Http::require(in_array($status, ['da_xem', 'da_tiep_thu'], true), 'Trạng thái phản hồi không hợp lệ');
        Http::require($reply === '' || (mb_strlen($reply) >= 3 && mb_strlen($reply) <= 2000), 'Nội dung trả lời phải có từ 3 đến 2000 ký tự');
        $this->db->beginTransaction();
        try {
        $statement = $this->db->prepare('SELECT crm_xu_ly_phan_hoi(:account,:feedback,CAST(:status AS trang_thai_phan_hoi))');
        $statement->execute(['account' => $accountId, 'feedback' => $feedbackId, 'status' => $status]);
        if ($reply !== '') {
            $update = $this->db->prepare('UPDATE phan_hoi SET phan_hoi_cua_nhan_vien=:reply,ngay_phan_hoi=clock_timestamp() WHERE id=:id RETURNING khach_hang_id');
            $update->execute(['reply' => $reply, 'id' => $feedbackId]);
            $customerId = (int) $update->fetchColumn();
            $notify = $this->db->prepare("INSERT INTO thong_bao(tai_khoan_id,loai,tieu_de,noi_dung,lien_ket) VALUES (:customer,'feedback_reply','Phản hồi của bạn đã được trả lời',:content,'my-feedback')");
            $notify->execute(['customer' => $customerId, 'content' => $reply]);
        }
        $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
        Http::json(200, ['message' => 'Đã cập nhật trạng thái phản hồi']);
    }

    private function createSurvey(int $accountId, array $body): never
    {
        $titleValue = $body['title'] ?? null;
        Http::require(is_string($titleValue), 'Tiêu đề khảo sát không hợp lệ');
        $title = trim($titleValue);
        $endAt = $this->parseSurveyDeadline($body['endAt'] ?? null);
        Http::require($endAt === null || $endAt > new \DateTimeImmutable('now', new \DateTimeZone('UTC')), 'Hạn khảo sát phải là thời điểm trong tương lai');
        $questions = $this->normalizeSurveyQuestions($body['questions'] ?? null);
        $customerIds = $body['customerIds'] ?? null;
        Http::require(mb_strlen($title) >= 3 && mb_strlen($title) <= 255, 'Tiêu đề khảo sát phải có từ 3 đến 255 ký tự');
        Http::require($customerIds === null || (is_array($customerIds) && $customerIds !== []), 'Vui lòng chọn ít nhất một khách hàng nhận khảo sát');
        if (is_array($customerIds)) {
            foreach ($customerIds as $customerId) {
                Http::require(filter_var($customerId, FILTER_VALIDATE_INT) !== false && (int) $customerId > 0, 'Danh sách khách hàng nhận khảo sát không hợp lệ');
            }
        }
        $this->db->beginTransaction();
        try {
            $surveyStatement = $this->db->prepare('INSERT INTO khao_sat(tieu_de,nguoi_tao_id,ngay_ket_thuc) VALUES (:title,:account,:end_at) RETURNING id');
            $surveyStatement->execute(['title' => $title, 'account' => $accountId, 'end_at' => $endAt?->format('Y-m-d H:i:sP')]);
            $surveyId = (int) $surveyStatement->fetchColumn();
            $questionStatement = $this->db->prepare('INSERT INTO cau_hoi(khao_sat_id,noi_dung,thu_tu,bat_buoc) VALUES (:survey,:content,:position,true) RETURNING id');
            $choiceStatement = $this->db->prepare('INSERT INTO lua_chon(cau_hoi_id,noi_dung,thu_tu) VALUES (:question,:content,:position)');
            foreach ($questions as $questionIndex => $question) {
                $questionStatement->execute(['survey' => $surveyId, 'content' => $question['content'], 'position' => $questionIndex + 1]);
                $questionId = (int) $questionStatement->fetchColumn();
                foreach ($question['choices'] as $choiceIndex => $choice) {
                    $choiceStatement->execute(['question' => $questionId, 'content' => $choice, 'position' => $choiceIndex + 1]);
                }
            }
            $publish = $this->db->prepare(<<<'SQL'
                WITH recipients AS (SELECT CAST(:customer_ids AS jsonb) AS ids)
                SELECT crm_phat_hanh_khao_sat(
                    :account,:survey,
                    CASE WHEN ids IS NULL THEN NULL
                         ELSE ARRAY(SELECT jsonb_array_elements_text(ids)::bigint)
                    END
                ) FROM recipients
            SQL);
            $publish->execute([
                'account' => $accountId,
                'survey' => $surveyId,
                'customer_ids' => $customerIds === null ? null : json_encode(array_map('intval', $customerIds), JSON_THROW_ON_ERROR),
            ]);
            $recipients = (int) $publish->fetchColumn();
            $notification = $this->db->prepare("INSERT INTO thong_bao(tai_khoan_id,loai,tieu_de,noi_dung,lien_ket) SELECT khach_hang_id,'survey','Khảo sát mới',:content,'my-surveys' FROM phan_phoi_khao_sat WHERE khao_sat_id=:survey");
            $notification->execute(['content' => $title, 'survey' => $surveyId]);
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
        Http::json(201, ['surveyId' => $surveyId, 'recipients' => $recipients, 'message' => 'Đã phát hành khảo sát và gửi thông báo']);
    }

    private function updateSurvey(int $surveyId, array $body): never
    {
        $titleValue = $body['title'] ?? null;
        Http::require(is_string($titleValue), 'Tiêu đề khảo sát không hợp lệ');
        $title = trim($titleValue);
        $endAt = $this->parseSurveyDeadline($body['endAt'] ?? null);
        $questions = $this->normalizeSurveyQuestions($body['questions'] ?? null);
        Http::require(mb_strlen($title) >= 3 && mb_strlen($title) <= 255, 'Tiêu đề khảo sát phải có từ 3 đến 255 ký tự');

        $this->db->beginTransaction();
        try {
            $statement = $this->db->prepare('SELECT k.id,k.ngay_ket_thuc AS "endAt" FROM khao_sat k WHERE k.id=:id FOR UPDATE');
            $statement->execute(['id' => $surveyId]);
            $survey = $statement->fetch();
            if (!$survey) {
                throw new ApiException(404, 'SURVEY_NOT_FOUND', 'Không tìm thấy khảo sát');
            }
            $completedStatement = $this->db->prepare('SELECT count(*)::int FROM phan_phoi_khao_sat WHERE khao_sat_id=:id AND ngay_hoan_thanh IS NOT NULL');
            $completedStatement->execute(['id' => $surveyId]);
            $survey['completed'] = (int) $completedStatement->fetchColumn();

            $currentQuestions = $this->surveyQuestionContent($surveyId);
            $questionsChanged = $questions !== $currentQuestions;
            if ((int) $survey['completed'] > 0 && $questionsChanged) {
                throw new ApiException(409, 'SURVEY_QUESTIONS_LOCKED', 'Không thể sửa câu hỏi hoặc lựa chọn vì khảo sát đã có phản hồi hoàn thành');
            }
            $currentEndAt = $survey['endAt'] === null ? null : new \DateTimeImmutable($survey['endAt']);
            if ($endAt !== null && $endAt <= new \DateTimeImmutable('now', new \DateTimeZone('UTC'))
                && ($currentEndAt === null || intdiv($endAt->getTimestamp(), 60) !== intdiv($currentEndAt->getTimestamp(), 60))) {
                throw new ApiException(400, 'INVALID_SURVEY_DEADLINE', 'Hạn khảo sát phải là thời điểm trong tương lai');
            }

            $update = $this->db->prepare('UPDATE khao_sat SET tieu_de=:title,ngay_ket_thuc=:end_at WHERE id=:id');
            $update->execute([
                'title' => $title,
                'end_at' => $endAt?->format('Y-m-d H:i:sP'),
                'id' => $surveyId,
            ]);

            if ($questionsChanged) {
                $deleteChoices = $this->db->prepare('DELETE FROM lua_chon WHERE cau_hoi_id IN (SELECT id FROM cau_hoi WHERE khao_sat_id=:id)');
                $deleteChoices->execute(['id' => $surveyId]);
                $deleteQuestions = $this->db->prepare('DELETE FROM cau_hoi WHERE khao_sat_id=:id');
                $deleteQuestions->execute(['id' => $surveyId]);
                $questionStatement = $this->db->prepare('INSERT INTO cau_hoi(khao_sat_id,noi_dung,thu_tu,bat_buoc) VALUES (:survey,:content,:position,true) RETURNING id');
                $choiceStatement = $this->db->prepare('INSERT INTO lua_chon(cau_hoi_id,noi_dung,thu_tu) VALUES (:question,:content,:position)');
                foreach ($questions as $questionIndex => $question) {
                    $questionStatement->execute(['survey' => $surveyId, 'content' => $question['content'], 'position' => $questionIndex + 1]);
                    $questionId = (int) $questionStatement->fetchColumn();
                    foreach ($question['choices'] as $choiceIndex => $choice) {
                        $choiceStatement->execute(['question' => $questionId, 'content' => $choice, 'position' => $choiceIndex + 1]);
                    }
                }
            }
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }

        Http::json(200, ['message' => 'Đã cập nhật khảo sát']);
    }

    private function setSurveyVisibility(int $surveyId, array $body): never
    {
        Http::require(isset($body['hidden']) && is_bool($body['hidden']), 'Trạng thái ẩn khảo sát không hợp lệ');
        $statement = $this->db->prepare('UPDATE khao_sat SET da_an=CAST(:hidden AS boolean) WHERE id=:id RETURNING da_an');
        $statement->execute(['hidden' => $body['hidden'] ? 'true' : 'false', 'id' => $surveyId]);
        if ($statement->rowCount() === 0) {
            throw new ApiException(404, 'SURVEY_NOT_FOUND', 'Không tìm thấy khảo sát');
        }
        Http::json(200, ['hidden' => $body['hidden'], 'message' => $body['hidden'] ? 'Đã ẩn khảo sát' : 'Đã khôi phục khảo sát']);
    }

    private function surveyDetails(int $surveyId): array
    {
        $statement = $this->db->prepare(<<<'SQL'
            SELECT k.id,k.tieu_de AS title,k.mo_ta AS description,k.trang_thai AS status,
                   k.ngay_ket_thuc AS "endAt",k.da_an AS hidden,
                   count(p.khach_hang_id)::int AS recipients,count(p.ngay_hoan_thanh)::int AS completed
              FROM khao_sat k LEFT JOIN phan_phoi_khao_sat p ON p.khao_sat_id=k.id
             WHERE k.id=:id GROUP BY k.id
        SQL);
        $statement->execute(['id' => $surveyId]);
        $survey = $statement->fetch();
        if (!$survey) {
            throw new ApiException(404, 'SURVEY_NOT_FOUND', 'Không tìm thấy khảo sát');
        }
        $survey['questions'] = $this->surveyQuestionContent($surveyId);
        $survey['hidden'] = in_array($survey['hidden'], [true, 't', '1', 1], true);
        return $survey;
    }

    private function surveyQuestionContent(int $surveyId): array
    {
        $statement = $this->db->prepare(<<<'SQL'
            SELECT c.id,c.noi_dung AS content,l.noi_dung AS choice
              FROM cau_hoi c LEFT JOIN lua_chon l ON l.cau_hoi_id=c.id
             WHERE c.khao_sat_id=:id
             ORDER BY c.thu_tu,l.thu_tu
        SQL);
        $statement->execute(['id' => $surveyId]);
        $questions = [];
        foreach ($statement->fetchAll() as $row) {
            $questionId = (int) $row['id'];
            if (!isset($questions[$questionId])) {
                $questions[$questionId] = ['content' => $row['content'], 'choices' => []];
            }
            if ($row['choice'] !== null) {
                $questions[$questionId]['choices'][] = $row['choice'];
            }
        }
        return array_values($questions);
    }

    private function parseSurveyDeadline(mixed $value): ?\DateTimeImmutable
    {
        if ($value === null || $value === '') {
            return null;
        }
        Http::require(
            is_string($value) && (bool) preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/D', $value),
            'Thời hạn khảo sát không hợp lệ; vui lòng chọn lại ngày giờ'
        );
        try {
            $deadline = new \DateTimeImmutable($value);
        } catch (\Exception) {
            throw new ApiException(400, 'INVALID_SURVEY_DEADLINE', 'Thời hạn khảo sát không hợp lệ; vui lòng chọn lại ngày giờ');
        }
        $errors = \DateTimeImmutable::getLastErrors();
        if ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0)) {
            throw new ApiException(400, 'INVALID_SURVEY_DEADLINE', 'Thời hạn khảo sát không hợp lệ; vui lòng chọn lại ngày giờ');
        }
        return $deadline;
    }

    private function normalizeSurveyQuestions(mixed $questions): array
    {
        Http::require(is_array($questions) && $questions !== [], 'Khảo sát phải có ít nhất một câu hỏi');
        $normalized = [];
        foreach ($questions as $question) {
            Http::require(is_array($question), 'Dữ liệu câu hỏi không hợp lệ');
            $contentValue = $question['content'] ?? null;
            $rawChoices = $question['choices'] ?? null;
            Http::require(is_string($contentValue) && is_array($rawChoices), 'Mỗi câu hỏi cần nội dung và ít nhất hai lựa chọn');
            $content = trim($contentValue);
            Http::require(mb_strlen($content) >= 3, 'Mỗi câu hỏi cần nội dung và ít nhất hai lựa chọn');
            $choices = [];
            foreach ($rawChoices as $choice) {
                Http::require(is_string($choice) || is_int($choice) || is_float($choice), 'Nội dung lựa chọn không hợp lệ');
                $choice = trim((string) $choice);
                if ($choice !== '') {
                    Http::require(mb_strlen($choice) <= 500, 'Mỗi lựa chọn không được vượt quá 500 ký tự');
                    $choices[] = $choice;
                }
            }
            Http::require(count($choices) >= 2, 'Mỗi câu hỏi cần ít nhất hai lựa chọn');
            $normalized[] = ['content' => $content, 'choices' => $choices];
        }
        return $normalized;
    }

    private function surveys(): array
    {
        $surveys = $this->db->query(<<<'SQL'
            SELECT k.id,k.tieu_de AS title,k.mo_ta AS description,k.trang_thai AS status,
                   k.ngay_tao AS "createdAt",k.ngay_ket_thuc AS "endAt",k.da_an AS hidden,
                   count(p.khach_hang_id)::int AS recipients,count(p.ngay_hoan_thanh)::int AS completed,
                   coalesce(round(100.0*count(p.ngay_hoan_thanh)/nullif(count(p.khach_hang_id),0),2),0) AS "completionRate"
              FROM khao_sat k LEFT JOIN phan_phoi_khao_sat p ON p.khao_sat_id=k.id
             GROUP BY k.id ORDER BY k.ngay_tao DESC,k.id DESC
        SQL)->fetchAll();
        foreach ($surveys as &$survey) {
            $survey['hidden'] = in_array($survey['hidden'], [true, 't', '1', 1], true);
        }
        unset($survey);
        return $surveys;
    }

    private function surveyResults(int $surveyId): array
    {
        $survey = $this->db->prepare(<<<'SQL'
            SELECT k.id,k.tieu_de AS title,k.trang_thai AS status,
                   count(p.khach_hang_id)::int AS recipients,count(p.ngay_hoan_thanh)::int AS completed,
                   coalesce(round(100.0*count(p.ngay_hoan_thanh)/nullif(count(p.khach_hang_id),0),2),0) AS "completionRate"
              FROM khao_sat k LEFT JOIN phan_phoi_khao_sat p ON p.khao_sat_id=k.id
             WHERE k.id=:id GROUP BY k.id
        SQL);
        $survey->execute(['id' => $surveyId]);
        $summary = $survey->fetch();
        if (!$summary) {
            throw new ApiException(404, 'SURVEY_NOT_FOUND', 'Không tìm thấy khảo sát');
        }

        $statement = $this->db->prepare(<<<'SQL'
            SELECT cau_hoi_id AS id,cau_hoi AS content,thu_tu_cau AS position,
                   lua_chon_id AS "choiceId",lua_chon AS choice,thu_tu_lua_chon AS "choicePosition",
                   so_luot_chon AS count,so_nguoi_tra_loi_cau AS respondents,ty_le_phan_tram AS percentage
              FROM v_ket_qua_khao_sat WHERE khao_sat_id=:id
             ORDER BY thu_tu_cau,thu_tu_lua_chon
        SQL);
        $statement->execute(['id' => $surveyId]);
        $questions = [];
        foreach ($statement->fetchAll() as $row) {
            $questionId = (int) $row['id'];
            if (!isset($questions[$questionId])) {
                $questions[$questionId] = [
                    'id' => $questionId,
                    'content' => $row['content'],
                    'respondents' => (int) $row['respondents'],
                    'choices' => [],
                ];
            }
            $questions[$questionId]['choices'][] = [
                'id' => (int) $row['choiceId'],
                'content' => $row['choice'],
                'count' => (int) $row['count'],
                'percentage' => $row['percentage'],
            ];
        }

        return ['survey' => $summary, 'questions' => array_values($questions)];
    }

    private function accounts(): array
    {
        return $this->db->query(<<<'SQL'
            SELECT t.id,t.ten_dang_nhap AS username,t.vai_tro AS role,t.trang_thai AS status,
                   t.ngay_tao AS "createdAt"
              FROM tai_khoan t
             WHERE t.vai_tro<>'customer' ORDER BY t.id
        SQL)->fetchAll();
    }

    private function catalogs(): array
    {
        return [
            'drinks' => $this->db->query('SELECT id,ma_do_uong AS code,ten_do_uong AS name,mo_ta AS description,dang_kinh_doanh AS active FROM do_uong ORDER BY id')->fetchAll(),
            'preferences' => $this->db->query('SELECT id,ten_nhom AS name,mo_ta AS description,dang_su_dung AS active FROM nhom_so_thich ORDER BY id')->fetchAll(),
        ];
    }

    private function updateCustomerProfile(int $accountId, int $customerId, array $body, string $role): never
    {
        Http::require($role === 'manager', 'Chỉ Manager mới được cập nhật hồ sơ khách hàng', 'FORBIDDEN');
        $name = trim((string) ($body['hoTen'] ?? ''));
        $birthYear = filter_var($body['namSinh'] ?? null, FILTER_VALIDATE_INT);
        $gender = (string) ($body['gioiTinh'] ?? 'khong_cung_cap');
        $preferenceId = filter_var($body['soThichId'] ?? null, FILTER_VALIDATE_INT);

        Http::require(mb_strlen($name) >= 2 && mb_strlen($name) <= 150, 'Họ tên phải có từ 2 đến 150 ký tự');
        Http::require($birthYear !== false && $birthYear >= 1900 && $birthYear <= (int) date('Y'), 'Năm sinh không hợp lệ');
        Http::require(in_array($gender, ['nam', 'nu', 'khac', 'khong_cung_cap'], true), 'Giới tính không hợp lệ');
        Http::require($preferenceId !== false && $preferenceId > 0, 'Vui lòng chọn nhóm sở thích');

        $this->db->beginTransaction();
        try {
            $perm = $this->db->prepare("SELECT crm_kiem_tra_quyen(:account, ARRAY['manager']::vai_tro[])");
            $perm->execute(['account' => $accountId]);

            $prefCheck = $this->db->prepare("SELECT 1 FROM nhom_so_thich WHERE id = :id AND dang_su_dung");
            $prefCheck->execute(['id' => $preferenceId]);
            Http::require((bool) $prefCheck->fetchColumn(), 'Sở thích không tồn tại hoặc đã ngừng sử dụng');

            $update = $this->db->prepare(<<<'SQL'
                UPDATE khach_hang
                   SET ho_ten = :name, nam_sinh = :birthYear, gioi_tinh = CAST(:gender AS gioi_tinh),
                       so_thich_id = :preferenceId, ngay_cap_nhat = clock_timestamp()
                 WHERE tai_khoan_id = :customerId
            SQL);
            $update->execute([
                'name' => $name,
                'birthYear' => $birthYear,
                'gender' => $gender,
                'preferenceId' => $preferenceId,
                'customerId' => $customerId,
            ]);
            Http::require($update->rowCount() > 0, 'Không tìm thấy hồ sơ khách hàng', 'CUSTOMER_NOT_FOUND');
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }

        Http::json(200, ['message' => 'Đã cập nhật hồ sơ khách hàng', 'customer' => $this->customerById($customerId)]);
    }

    private function customerRequests(array $account): array
    {
        if ($account['role'] === 'admin') {
            return $this->db->query(<<<'SQL'
                SELECT r.id, r.khach_hang_id AS "customerId", r.loai AS action, r.ly_do AS reason,
                       r.trang_thai AS status, r.ngay_tao AS "createdAt",
                       a.ten_dang_nhap AS "requesterUsername", n.ho_ten AS "requesterName",
                       COALESCE(h.ho_ten, r.khach_hang_ten) AS "customerName", r.ghi_chu_quyet_dinh AS "decisionNote",
                       r.ngay_quyet_dinh AS "decidedAt"
                  FROM yeu_cau_admin_khach_hang r
                  JOIN tai_khoan a ON a.id = r.nguoi_yeu_cau_id
                  LEFT JOIN nhan_vien_noi_bo n ON n.tai_khoan_id = a.id
                  LEFT JOIN khach_hang h ON h.tai_khoan_id = r.khach_hang_id
                 WHERE r.loai IN ('lock_customer', 'unlock_customer')
                 ORDER BY (r.trang_thai = 'pending') DESC, r.ngay_tao DESC
            SQL)->fetchAll();
        }

        $stmt = $this->db->prepare(<<<'SQL'
            SELECT r.id, r.khach_hang_id AS "customerId", r.loai AS action, r.ly_do AS reason,
                   r.trang_thai AS status, r.ngay_tao AS "createdAt",
                   COALESCE(h.ho_ten, r.khach_hang_ten) AS "customerName", r.ghi_chu_quyet_dinh AS "decisionNote",
                   r.ngay_quyet_dinh AS "decidedAt"
              FROM yeu_cau_admin_khach_hang r
              LEFT JOIN khach_hang h ON h.tai_khoan_id = r.khach_hang_id
             WHERE r.nguoi_yeu_cau_id = :managerId AND r.loai IN ('lock_customer', 'unlock_customer')
             ORDER BY r.ngay_tao DESC
        SQL);
        $stmt->execute(['managerId' => (int) $account['id']]);
        return $stmt->fetchAll();
    }

    private function createCustomerRequest(int $managerId, array $body, string $role): never
    {
        Http::require($role === 'manager', 'Chỉ Manager mới được gửi yêu cầu lên Admin', 'FORBIDDEN');
        $customerId = filter_var($body['customerId'] ?? null, FILTER_VALIDATE_INT);
        Http::require($customerId !== false && $customerId > 0, 'Mã khách hàng không hợp lệ');
        $action = (string) ($body['action'] ?? 'lock_customer');
        Http::require(in_array($action, ['lock_customer', 'unlock_customer'], true), 'Loại yêu cầu không hợp lệ');
        $isUnlock = $action === 'unlock_customer';
        $reason = trim((string) ($body['reason'] ?? ''));
        Http::require(mb_strlen($reason) >= 5 && mb_strlen($reason) <= 2000, 'Lý do yêu cầu phải có từ 5 đến 2000 ký tự');

        $this->db->beginTransaction();
        try {
            $perm = $this->db->prepare("SELECT crm_kiem_tra_quyen(:account, ARRAY['manager']::vai_tro[])");
            $perm->execute(['account' => $managerId]);

            $checkCust = $this->db->prepare("SELECT t.id, t.trang_thai, h.ho_ten FROM tai_khoan t JOIN khach_hang h ON h.tai_khoan_id = t.id WHERE t.id = :id AND t.vai_tro = 'customer'");
            $checkCust->execute(['id' => $customerId]);
            $target = $checkCust->fetch();
            Http::require((bool) $target, 'Không tìm thấy khách hàng', 'CUSTOMER_NOT_FOUND');

            if ($isUnlock) {
                Http::require($target['trang_thai'] === 'locked', 'Chỉ có thể yêu cầu mở khóa khách hàng đang bị khóa');
            } else {
                Http::require($target['trang_thai'] === 'active', 'Chỉ có thể yêu cầu khóa khách hàng đang hoạt động');
            }

            $existing = $this->db->prepare("SELECT 1 FROM yeu_cau_admin_khach_hang WHERE khach_hang_id = :id AND loai = :act AND trang_thai = 'pending'");
            $existing->execute(['id' => $customerId, 'act' => $action]);
            Http::require(!(bool) $existing->fetchColumn(), $isUnlock ? 'Đã có yêu cầu mở khóa đang chờ Admin xử lý' : 'Đã có yêu cầu khóa đang chờ Admin xử lý');

            $insert = $this->db->prepare(<<<'SQL'
                INSERT INTO yeu_cau_admin_khach_hang(nguoi_yeu_cau_id, khach_hang_id, khach_hang_ten, loai, ly_do)
                VALUES (:requester, :customer, :custName, :action, :reason)
                RETURNING id
            SQL);
            $insert->execute([
                'requester' => $managerId,
                'customer' => $customerId,
                'custName' => $target['ho_ten'],
                'action' => $action,
                'reason' => $reason,
            ]);
            $requestId = (int) $insert->fetchColumn();
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }

        Http::json(201, [
            'id' => $requestId,
            'message' => $isUnlock ? 'Đã gửi đề xuất mở khóa lên Admin thành công' : 'Đã gửi đề xuất khóa lên Admin thành công'
        ]);
    }

    private function decideCustomerRequest(int $adminId, int $requestId, array $body): never
    {
        $status = (string) ($body['status'] ?? '');
        Http::require(in_array($status, ['approved', 'rejected'], true), 'Quyết định không hợp lệ');
        $note = trim((string) ($body['note'] ?? ''));

        $this->db->beginTransaction();
        try {
            $perm = $this->db->prepare("SELECT crm_kiem_tra_quyen(:account, ARRAY['admin']::vai_tro[])");
            $perm->execute(['account' => $adminId]);

            $stmt = $this->db->prepare("SELECT id, khach_hang_id, loai, trang_thai FROM yeu_cau_admin_khach_hang WHERE id = :id FOR UPDATE");
            $stmt->execute(['id' => $requestId]);
            $req = $stmt->fetch();
            Http::require((bool) $req, 'Không tìm thấy yêu cầu');
            Http::require($req['trang_thai'] === 'pending', 'Yêu cầu này đã được xử lý');
            Http::require(in_array($req['loai'], ['lock_customer', 'unlock_customer'], true), 'Loại yêu cầu này không còn được hỗ trợ');

            if ($status === 'approved') {
                $targetStatus = $req['loai'] === 'unlock_customer' ? 'active' : 'locked';
                $lock = $this->db->prepare("SELECT crm_dat_trang_thai_khach_hang(:admin, :cust, CAST(:st AS trang_thai_tai_khoan))");
                $lock->execute(['admin' => $adminId, 'cust' => $req['khach_hang_id'], 'st' => $targetStatus]);
            }

            $upd = $this->db->prepare(<<<'SQL'
                UPDATE yeu_cau_admin_khach_hang
                   SET trang_thai = :status, nguoi_quyet_dinh_id = :admin,
                       ghi_chu_quyet_dinh = :note, ngay_quyet_dinh = clock_timestamp()
                 WHERE id = :id
            SQL);
            $upd->execute([
                'status' => $status,
                'admin' => $adminId,
                'note' => $note ?: null,
                'id' => $requestId,
            ]);
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }

        $msg = $status === 'rejected'
            ? 'Đã từ chối yêu cầu'
            : ($req['loai'] === 'unlock_customer' ? 'Đã phê duyệt và mở khóa khách hàng' : 'Đã phê duyệt và khóa khách hàng');

        Http::json(200, ['message' => $msg]);
    }

    private function managers(): array
    {
        return $this->db->query(<<<'SQL'
            SELECT t.id, t.ten_dang_nhap AS username, t.trang_thai AS status,
                   t.ngay_tao AS "createdAt", n.ho_ten AS "fullName",
                   n.chuc_vu AS "jobTitle", n.bo_phan AS department
              FROM tai_khoan t LEFT JOIN nhan_vien_noi_bo n ON n.tai_khoan_id = t.id
             WHERE t.vai_tro = 'manager' ORDER BY t.ngay_tao DESC
        SQL)->fetchAll();
    }

    private function createManager(int $adminId, array $body): never
    {
        $username = trim((string) ($body['tenDangNhap'] ?? ''));
        $password = (string) ($body['matKhau'] ?? '');
        $fullName = trim((string) ($body['hoTen'] ?? ''));
        $jobTitle = trim((string) ($body['chucVu'] ?? ''));
        $department = trim((string) ($body['boPhan'] ?? ''));

        Http::require((bool) preg_match('/^[a-zA-Z0-9._-]{3,100}$/', $username), 'Tên đăng nhập không hợp lệ');
        Http::require(strlen($password) >= 8 && strlen($password) <= 128, 'Mật khẩu phải từ 8 đến 128 ký tự');
        Http::require(mb_strlen($fullName) >= 2 && mb_strlen($fullName) <= 150, 'Họ tên không hợp lệ');
        Http::require(mb_strlen($jobTitle) >= 2 && mb_strlen($jobTitle) <= 150, 'Chức vụ không hợp lệ');

        $this->db->beginTransaction();
        try {
            $perm = $this->db->prepare("SELECT crm_kiem_tra_quyen(:account, ARRAY['admin']::vai_tro[])");
            $perm->execute(['account' => $adminId]);

            $insTk = $this->db->prepare("INSERT INTO tai_khoan(ten_dang_nhap, mat_khau_hash, vai_tro, nguoi_tao_id) VALUES (:u, :p, 'manager', :creator) RETURNING id");
            $insTk->execute(['u' => strtolower($username), 'p' => Auth::hashPassword($password), 'creator' => $adminId]);
            $mgrId = (int) $insTk->fetchColumn();

            $insNv = $this->db->prepare("INSERT INTO nhan_vien_noi_bo(tai_khoan_id, ho_ten, chuc_vu, bo_phan) VALUES (:id, :name, :job, :dept)");
            $insNv->execute(['id' => $mgrId, 'name' => $fullName, 'job' => $jobTitle, 'dept' => $department]);

            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }

        Http::json(201, ['id' => $mgrId, 'message' => 'Đã tạo tài khoản Manager']);
    }

    private function updateManager(int $managerId, array $body): never
    {
        $fullName = trim((string) ($body['hoTen'] ?? ''));
        $jobTitle = trim((string) ($body['chucVu'] ?? ''));
        $department = trim((string) ($body['boPhan'] ?? ''));
        $status = isset($body['status']) ? (string) $body['status'] : null;

        Http::require(mb_strlen($fullName) >= 2 && mb_strlen($fullName) <= 150, 'Họ tên không hợp lệ');
        Http::require(mb_strlen($jobTitle) >= 2 && mb_strlen($jobTitle) <= 150, 'Chức vụ không hợp lệ');
        if ($status !== null) {
            Http::require(in_array($status, ['active', 'locked'], true), 'Trạng thái không hợp lệ');
        }

        $this->db->beginTransaction();
        try {
            if ($status !== null) {
                $updTk = $this->db->prepare("UPDATE tai_khoan SET trang_thai = CAST(:st AS trang_thai_tai_khoan) WHERE id = :id AND vai_tro = 'manager'");
                $updTk->execute(['st' => $status, 'id' => $managerId]);
            }

            $updNv = $this->db->prepare(<<<'SQL'
                INSERT INTO nhan_vien_noi_bo(tai_khoan_id, ho_ten, chuc_vu, bo_phan)
                VALUES (:id, :name, :job, :dept)
                ON CONFLICT (tai_khoan_id) DO UPDATE
                   SET ho_ten = EXCLUDED.ho_ten, chuc_vu = EXCLUDED.chuc_vu,
                       bo_phan = EXCLUDED.bo_phan, ngay_cap_nhat = clock_timestamp()
            SQL);
            $updNv->execute(['id' => $managerId, 'name' => $fullName, 'job' => $jobTitle, 'dept' => $department]);

            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }

        Http::json(200, ['message' => 'Đã cập nhật thông tin Manager']);
    }
}
