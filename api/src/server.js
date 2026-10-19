import { createServer } from "node:http";
import { authenticate, createToken, hashPassword, verifyPassword } from "./auth.js";
import { config } from "./config.js";
import { pool, transaction } from "./database.js";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (response, status, data) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
};

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) throw new HttpError(413, "Dữ liệu gửi lên vượt quá giới hạn 1 MB");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || Array.isArray(body) || typeof body !== "object") throw new Error("Invalid JSON object");
    return body;
  } catch {
    throw new HttpError(400, "Nội dung yêu cầu phải là JSON hợp lệ");
  }
}

function requireValue(value, name, { min = 1, max = 1000 } = {}) {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) {
    throw new HttpError(400, `${name} không hợp lệ`);
  }
  return value.trim();
}

function requireInteger(value, name, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new HttpError(400, `${name} không hợp lệ`);
  return number;
}

function requirePassword(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new HttpError(400, "Mật khẩu phải có từ 8 đến 128 ký tự");
  }
  return value;
}

function requireSession(account, roles) {
  if (!account) throw new HttpError(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn");
  if (!roles.includes(account.role)) throw new HttpError(403, "Bạn không có quyền thực hiện thao tác này");
  return account;
}

function requireDate(value, name, { allowPast = false } = {}) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || (!allowPast && date.getTime() <= Date.now())) {
    throw new HttpError(400, `${name} không hợp lệ hoặc đã qua`);
  }
  return date.toISOString();
}

function normalizeQuestions(questions) {
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 100) {
    throw new HttpError(400, "Khảo sát cần có ít nhất một câu hỏi");
  }
  return questions.map((question, index) => {
    const content = requireValue(question?.content, `Nội dung câu hỏi ${index + 1}`, { min: 3, max: 2000 });
    if (!Array.isArray(question.choices) || question.choices.length < 2 || question.choices.length > 50) {
      throw new HttpError(400, `Câu hỏi ${index + 1} cần ít nhất hai lựa chọn`);
    }
    const choices = question.choices.map((choice, choiceIndex) =>
      requireValue(choice, `Lựa chọn ${choiceIndex + 1}`, { max: 500 })
    );
    if (new Set(choices.map(choice => choice.toLocaleLowerCase())).size !== choices.length) {
      throw new HttpError(400, `Câu hỏi ${index + 1} có lựa chọn bị trùng`);
    }
    return { content, choices, required: question.required !== false };
  });
}

function mapDatabaseError(error) {
  if (error instanceof HttpError) return error;
  if (error.code === "28P01") return new HttpError(503, "Không đăng nhập được vào PostgreSQL. Kiểm tra DB_USER và DB_PASSWORD trong api/.env.");
  if (error.code === "3D000") return new HttpError(503, "Không tìm thấy database. Kiểm tra DB_DSN trong api/.env.");
  if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {
    return new HttpError(503, "Không kết nối được PostgreSQL. Kiểm tra dịch vụ PostgreSQL, host và cổng trong api/.env.");
  }
  if (error.code === "23505" && error.constraint === "do_uong_ma_do_uong_key") return new HttpError(409, "Mã đồ uống đã tồn tại");
  if (error.code === "23505") return new HttpError(409, "Tên đăng nhập, mã thành viên hoặc dữ liệu này đã tồn tại");
  if (error.code === "23514" && error.constraint === "ck_yeu_cau_loai") {
    return new HttpError(503, "Database chưa cập nhật hỗ trợ mở khóa. Hãy chạy database/12_allow_unlock_customer_request.sql rồi khởi động lại API.");
  }
  if (["23503", "23514", "22P02", "22007", "22008", "22003"].includes(error.code)) {
    return new HttpError(400, "Dữ liệu không hợp lệ hoặc vi phạm quy tắc nghiệp vụ");
  }
  if (error.code === "P0001" || error.code === "P0002" || error.code === "P0003") {
    return new HttpError(400, error.message);
  }
  if (error.code === "42P01" || error.code === "42703") {
    console.error("Cấu trúc PostgreSQL chưa được cập nhật theo hướng dẫn database/README.md:", error.message);
    return new HttpError(503, "Database chưa được cài đủ cấu trúc cho API. Hãy chạy các tệp SQL trong database theo README.");
  }
  console.error("Lỗi API:", error);
  return new HttpError(500, "Máy chủ gặp lỗi khi xử lý yêu cầu");
}

async function getProfile(accountId) {
  const { rows } = await pool.query(
    `SELECT t.id, t.ten_dang_nhap AS "tenDangNhap", h.ma_thanh_vien AS "maThanhVien",
            h.ho_ten AS "hoTen", h.nam_sinh AS "namSinh", h.gioi_tinh AS "gioiTinh",
            h.so_thich_id AS "soThichId", s.ten_nhom AS "soThich",
            t.trang_thai AS status, t.ngay_tao AS "ngayTao"
       FROM tai_khoan t
       JOIN khach_hang h ON h.tai_khoan_id = t.id
       JOIN nhom_so_thich s ON s.id = h.so_thich_id
      WHERE t.id = $1 AND t.vai_tro = 'customer'`,
    [accountId]
  );
  if (!rows[0]) throw new HttpError(404, "Không tìm thấy hồ sơ khách hàng");
  return rows[0];
}

async function requireInternal(request, allowedRoles = ["admin", "manager"]) {
  return requireSession(await authenticate(request), allowedRoles);
}

async function requireCustomer(request) {
  return requireSession(await authenticate(request), ["customer"]);
}

async function login(body, allowedRoles) {
  const username = requireValue(body.tenDangNhap, "Tên đăng nhập", { max: 100 }).toLocaleLowerCase();
  const password = requirePassword(body.matKhau);
  const { rows } = await pool.query(
    `SELECT id, ten_dang_nhap, vai_tro, trang_thai, mat_khau_hash
       FROM tai_khoan WHERE ten_dang_nhap = $1`,
    [username]
  );
  const account = rows[0];
  if (!account || !(await verifyPassword(password, account.mat_khau_hash))) {
    throw new HttpError(401, "Tên đăng nhập hoặc mật khẩu không đúng");
  }
  if (account.trang_thai !== "active") throw new HttpError(403, "Tài khoản đã bị khóa");
  if (!allowedRoles.includes(account.vai_tro)) throw new HttpError(403, "Tài khoản không có quyền truy cập khu vực này");
  const publicAccount = { id: account.id, tenDangNhap: account.ten_dang_nhap, role: account.vai_tro };
  return { token: createToken(publicAccount), publicAccount };
}

async function createCustomerAccount(client, data, creatorId = null) {
  const username = requireValue(data.tenDangNhap, "Tên đăng nhập", { min: 3, max: 100 }).toLocaleLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) throw new HttpError(400, "Tên đăng nhập chỉ được gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang");
  const password = requirePassword(data.matKhau);
  const fullName = requireValue(data.hoTen, "Họ và tên", { min: 2, max: 150 });
  const birthYear = requireInteger(data.namSinh, "Năm sinh", 1900, new Date().getFullYear());
  const preferenceId = requireInteger(data.soThichId, "Sở thích");
  const gender = data.gioiTinh || "khong_cung_cap";
  if (!["nam", "nu", "khac", "khong_cung_cap"].includes(gender)) throw new HttpError(400, "Giới tính không hợp lệ");

  const preference = await client.query("SELECT id FROM nhom_so_thich WHERE id = $1 AND dang_su_dung", [preferenceId]);
  if (!preference.rowCount) throw new HttpError(400, "Sở thích không tồn tại hoặc đã ngừng sử dụng");
  const hash = await hashPassword(password);
  const { rows } = await client.query(
    `INSERT INTO tai_khoan(ten_dang_nhap, mat_khau_hash, vai_tro, nguoi_tao_id)
     VALUES ($1, $2, 'customer', $3) RETURNING id`,
    [username, hash, creatorId]
  );
  const accountId = rows[0].id;
  const code = `TV${String(accountId).padStart(6, "0")}`;
  await client.query(
    `INSERT INTO khach_hang(tai_khoan_id, ma_thanh_vien, ho_ten, nam_sinh, gioi_tinh, so_thich_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [accountId, code, fullName, birthYear, gender, preferenceId]
  );
  return accountId;
}

async function customerRoutes(request, response, method, path, body) {
  if (method === "GET" && path === "/catalogs/options") {
    const [preferences, drinks] = await Promise.all([
      pool.query(`SELECT id, ten_nhom AS "tenNhom" FROM nhom_so_thich WHERE dang_su_dung ORDER BY id`),
      pool.query(`SELECT id, ten_do_uong AS "tenDoUong" FROM do_uong WHERE dang_kinh_doanh ORDER BY ten_do_uong`)
    ]);
    json(response, 200, { preferences: preferences.rows, drinks: drinks.rows });
    return true;
  }
  if (method === "POST" && path === "/auth/login") {
    const { token, publicAccount } = await login(body, ["customer"]);
    json(response, 200, { token, profile: await getProfile(publicAccount.id) });
    return true;
  }
  if (method === "POST" && path === "/auth/register") {
    const passwordConfirmation = requirePassword(body.matKhauXacNhan);
    if (body.matKhau !== passwordConfirmation) throw new HttpError(400, "Mật khẩu xác nhận chưa khớp");
    const accountId = await transaction(client => createCustomerAccount(client, body));
    const profile = await getProfile(accountId);
    json(response, 201, { token: createToken({ id: accountId, role: "customer" }), profile });
    return true;
  }

  if (method === "GET" && path === "/me") {
    const customer = await requireCustomer(request);
    json(response, 200, { profile: await getProfile(customer.id) });
    return true;
  }
  if (method === "PATCH" && path === "/me") {
    const customer = await requireCustomer(request);
    const fullName = requireValue(body.hoTen, "Họ và tên", { min: 2, max: 150 });
    const birthYear = requireInteger(body.namSinh, "Năm sinh", 1900, new Date().getFullYear());
    const preferenceId = requireInteger(body.soThichId, "Sở thích");
    const gender = body.gioiTinh;
    if (!["nam", "nu", "khac", "khong_cung_cap"].includes(gender)) throw new HttpError(400, "Giới tính không hợp lệ");
    const result = await pool.query(
      `UPDATE khach_hang SET ho_ten = $2, nam_sinh = $3, gioi_tinh = $4, so_thich_id = $5
        WHERE tai_khoan_id = $1`,
      [customer.id, fullName, birthYear, gender, preferenceId]
    );
    if (!result.rowCount) throw new HttpError(404, "Không tìm thấy hồ sơ khách hàng");
    json(response, 200, { profile: await getProfile(customer.id) });
    return true;
  }
  if (method === "PATCH" && path === "/me/password") {
    const customer = await requireCustomer(request);
    const currentPassword = requirePassword(body.matKhauHienTai);
    const newPassword = requirePassword(body.matKhauMoi);
    if (currentPassword === newPassword) throw new HttpError(400, "Mật khẩu mới phải khác mật khẩu hiện tại");
    const { rows } = await pool.query("SELECT mat_khau_hash FROM tai_khoan WHERE id = $1", [customer.id]);
    if (!rows[0] || !(await verifyPassword(currentPassword, rows[0].mat_khau_hash))) {
      throw new HttpError(400, "Mật khẩu hiện tại không đúng");
    }
    await pool.query("UPDATE tai_khoan SET mat_khau_hash = $2 WHERE id = $1", [customer.id, await hashPassword(newPassword)]);
    json(response, 200, { message: "Đổi mật khẩu thành công" });
    return true;
  }
  if (path === "/me/feedback" && method === "GET") {
    const customer = await requireCustomer(request);
    const { rows } = await pool.query(
      `SELECT p.id, p.so_sao AS "soSao", p.noi_dung AS "noiDung", p.trang_thai AS "trangThai",
              p.phan_hoi_cua_nhan_vien AS "phanHoiCuaNhanVien", p.ngay_gui AS "ngayGui",
              p.ngay_phan_hoi AS "ngayPhanHoi",
              d.ten_do_uong AS "tenDoUong"
         FROM phan_hoi p JOIN do_uong d ON d.id = p.do_uong_id
        WHERE p.khach_hang_id = $1 ORDER BY p.ngay_gui DESC`,
      [customer.id]
    );
    json(response, 200, { feedback: rows });
    return true;
  }
  if (path === "/me/feedback" && method === "POST") {
    const customer = await requireCustomer(request);
    const drinkId = requireInteger(body.doUongId, "Đồ uống");
    const rating = requireInteger(body.soSao, "Số sao", 1, 5);
    const content = requireValue(body.noiDung, "Nội dung phản hồi", { min: 10, max: 5000 });
    const { rows } = await pool.query(
      `INSERT INTO phan_hoi(khach_hang_id, do_uong_id, so_sao, noi_dung)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [customer.id, drinkId, rating, content]
    );
    json(response, 201, { id: rows[0].id });
    return true;
  }
  if (path === "/me/surveys" && method === "GET") {
    const customer = await requireCustomer(request);
    const { rows } = await pool.query(
      `SELECT k.id, k.tieu_de AS "tieuDe", k.trang_thai AS "trangThai", k.ngay_ket_thuc AS "ngayKetThuc",
              p.ngay_hoan_thanh AS "ngayHoanThanh",
              (SELECT count(*)::int FROM cau_hoi c WHERE c.khao_sat_id = k.id) AS "soCauHoi"
         FROM phan_phoi_khao_sat p JOIN khao_sat k ON k.id = p.khao_sat_id
        WHERE p.khach_hang_id = $1 AND NOT k.da_an ORDER BY p.ngay_gui DESC`,
      [customer.id]
    );
    json(response, 200, { surveys: rows });
    return true;
  }
  const customerSurvey = path.match(/^\/me\/surveys\/(\d+)$/);
  if (method === "GET" && customerSurvey) {
    const customer = await requireCustomer(request);
    const id = requireInteger(customerSurvey[1], "Mã khảo sát");
    const { rows } = await pool.query(
      `SELECT k.id, k.tieu_de AS "title", k.mo_ta AS description, k.ngay_ket_thuc AS "endAt",
              k.trang_thai AS "status", k.da_an AS hidden, p.ngay_hoan_thanh AS completed
         FROM khao_sat k JOIN phan_phoi_khao_sat p ON p.khao_sat_id = k.id
        WHERE k.id = $1 AND p.khach_hang_id = $2`,
      [id, customer.id]
    );
    const survey = rows[0];
    if (!survey || survey.hidden || survey.status !== "dang_mo" || survey.completed ||
        (survey.endAt && new Date(survey.endAt) <= new Date())) {
      throw new HttpError(404, "Khảo sát không tồn tại hoặc không còn khả dụng");
    }
    const questions = await pool.query(
      `SELECT c.id, c.noi_dung AS content, c.bat_buoc AS required, c.thu_tu,
              l.id AS choice_id, l.noi_dung AS choice_content, l.thu_tu AS choice_order
         FROM cau_hoi c LEFT JOIN lua_chon l ON l.cau_hoi_id = c.id
        WHERE c.khao_sat_id = $1 ORDER BY c.thu_tu, l.thu_tu`,
      [id]
    );
    const questionMap = new Map();
    for (const row of questions.rows) {
      if (!questionMap.has(row.id)) questionMap.set(row.id, {
        id: row.id, content: row.content, batBuoc: row.required,
        choices: []
      });
      if (row.choice_id) questionMap.get(row.id).choices.push({ id: row.choice_id, content: row.choice_content });
    }
    json(response, 200, { survey: { id: survey.id, title: survey.title, questions: [...questionMap.values()] } });
    return true;
  }
  const completedCustomerSurvey = path.match(/^\/me\/surveys\/(\d+)\/results$/);
  if (method === "GET" && completedCustomerSurvey) {
    const customer = await requireCustomer(request);
    const id = requireInteger(completedCustomerSurvey[1], "Mã khảo sát");
    const surveyResult = await pool.query(
      `SELECT k.id, k.tieu_de AS title, k.mo_ta AS description,
              p.ngay_hoan_thanh AS "completedAt"
         FROM khao_sat k JOIN phan_phoi_khao_sat p ON p.khao_sat_id = k.id
        WHERE k.id = $1 AND p.khach_hang_id = $2 AND p.ngay_hoan_thanh IS NOT NULL`,
      [id, customer.id]
    );
    if (!surveyResult.rowCount) throw new HttpError(404, "Không tìm thấy kết quả khảo sát đã hoàn thành");
    const answers = await pool.query(
      `SELECT c.id, c.noi_dung AS content, c.bat_buoc AS required, c.thu_tu,
              l.id AS "choiceId", l.noi_dung AS "choiceContent"
         FROM cau_hoi c
         LEFT JOIN cau_tra_loi a ON a.khao_sat_id = c.khao_sat_id
          AND a.cau_hoi_id = c.id AND a.khach_hang_id = $2
         LEFT JOIN lua_chon l ON l.id = a.lua_chon_id
        WHERE c.khao_sat_id = $1 ORDER BY c.thu_tu`,
      [id, customer.id]
    );
    json(response, 200, { survey: { ...surveyResult.rows[0], questions: answers.rows } });
    return true;
  }
  const submitSurvey = path.match(/^\/me\/surveys\/(\d+)\/submit$/);
  if (method === "POST" && submitSurvey) {
    const customer = await requireCustomer(request);
    const id = requireInteger(submitSurvey[1], "Mã khảo sát");
    if (!Array.isArray(body.answers)) throw new HttpError(400, "Câu trả lời phải là một mảng");
    const answers = body.answers.map((answer, index) => ({
      cau_hoi_id: requireInteger(answer.cauHoiId, `Mã câu hỏi ${index + 1}`),
      lua_chon_id: requireInteger(answer.luaChonId, `Mã lựa chọn ${index + 1}`)
    }));
    await pool.query("SELECT crm_nop_khao_sat($1, $2, $3::jsonb)", [customer.id, id, JSON.stringify(answers)]);
    json(response, 200, { message: "Nộp khảo sát thành công" });
    return true;
  }
  if (method === "GET" && path === "/me/notifications") {
    const customer = await requireCustomer(request);
    const { rows } = await pool.query(
      `SELECT id, loai AS type, tieu_de AS title, noi_dung AS content, lien_ket AS link,
              da_doc AS read, ngay_tao AS "createdAt"
         FROM thong_bao WHERE tai_khoan_id = $1 ORDER BY ngay_tao DESC, id DESC LIMIT 50`,
      [customer.id]
    );
    json(response, 200, { notifications: rows });
    return true;
  }
  if (method === "PATCH" && path === "/me/notifications/read-all") {
    const customer = await requireCustomer(request);
    const result = await pool.query(
      `UPDATE thong_bao SET da_doc = true, ngay_doc = coalesce(ngay_doc, clock_timestamp())
        WHERE tai_khoan_id = $1 AND NOT da_doc`,
      [customer.id]
    );
    json(response, 200, { updated: result.rowCount });
    return true;
  }
  const notification = path.match(/^\/me\/notifications\/(\d+)$/);
  if (method === "PATCH" && notification) {
    const customer = await requireCustomer(request);
    const result = await pool.query(
      `UPDATE thong_bao SET da_doc = true, ngay_doc = coalesce(ngay_doc, clock_timestamp())
        WHERE id = $1 AND tai_khoan_id = $2`,
      [requireInteger(notification[1], "Mã thông báo"), customer.id]
    );
    if (!result.rowCount) throw new HttpError(404, "Không tìm thấy thông báo");
    json(response, 200, { message: "Đã đánh dấu thông báo đã đọc" });
    return true;
  }
  return false;
}

async function listCustomers() {
  const { rows } = await pool.query(
    `SELECT h.tai_khoan_id AS id, h.ma_thanh_vien AS code, h.ho_ten AS name,
            h.nam_sinh AS birth_year, h.gioi_tinh AS gender, h.so_thich_id AS "preferenceId",
            extract(year FROM current_date)::int - h.nam_sinh AS age,
            s.ten_nhom AS preference, t.ten_dang_nhap AS username,
            t.trang_thai AS status, h.ngay_cap_nhat AS "updatedAt"
       FROM khach_hang h JOIN tai_khoan t ON t.id = h.tai_khoan_id
       JOIN nhom_so_thich s ON s.id = h.so_thich_id
      ORDER BY h.ngay_cap_nhat DESC, h.tai_khoan_id DESC`
  );
  return rows;
}

async function getSurveyQuestions(client, surveyId) {
  const { rows } = await client.query(
    `SELECT c.id, c.noi_dung AS content, c.thu_tu AS ordering, c.bat_buoc AS required,
            l.id AS choice_id, l.noi_dung AS choice_content, l.thu_tu AS choice_order
       FROM cau_hoi c LEFT JOIN lua_chon l ON l.cau_hoi_id = c.id
      WHERE c.khao_sat_id = $1 ORDER BY c.thu_tu, l.thu_tu`,
    [surveyId]
  );
  const questions = new Map();
  for (const row of rows) {
    if (!questions.has(row.id)) questions.set(row.id, {
      id: row.id, content: row.content, required: row.required, choices: []
    });
    if (row.choice_id) questions.get(row.id).choices.push({ id: row.choice_id, content: row.choice_content });
  }
  return [...questions.values()];
}

async function addSurveyQuestions(client, surveyId, questions) {
  for (const [index, question] of questions.entries()) {
    const { rows } = await client.query(
      `INSERT INTO cau_hoi(khao_sat_id, noi_dung, thu_tu, bat_buoc)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [surveyId, question.content, index + 1, question.required]
    );
    for (const [choiceIndex, choice] of question.choices.entries()) {
      await client.query(
        `INSERT INTO lua_chon(cau_hoi_id, noi_dung, thu_tu) VALUES ($1, $2, $3)`,
        [rows[0].id, choice, choiceIndex + 1]
      );
    }
  }
}

async function internalRoutes(request, response, method, path, body) {
  if (method === "POST" && path === "/internal/auth/login") {
    const { token, publicAccount } = await login(body, ["admin", "manager"]);
    json(response, 200, { token, account: publicAccount });
    return true;
  }
  if (!path.startsWith("/internal/")) return false;
  const session = await requireInternal(request);

  if (method === "GET" && path === "/internal/me") {
    json(response, 200, { account: { id: session.id, tenDangNhap: session.tenDangNhap, role: session.role } });
    return true;
  }
  if (method === "GET" && path === "/internal/dashboard") {
    const { rows } = await pool.query(
      `SELECT
        (SELECT count(*)::int FROM tai_khoan) AS "totalAccounts",
        (SELECT count(*)::int FROM khach_hang) AS "totalCustomers",
        (SELECT count(*)::int FROM phan_hoi WHERE trang_thai = 'moi') AS "newFeedback",
        (SELECT count(*)::int FROM phan_hoi) AS "totalFeedback",
        (SELECT count(*)::int FROM khao_sat) AS "totalSurveys"`
    );
    json(response, 200, { summary: rows[0] });
    return true;
  }
  if (method === "GET" && path === "/internal/customers") {
    json(response, 200, { customers: await listCustomers() });
    return true;
  }
  if (method === "POST" && path === "/internal/customers") {
    if (session.role !== "manager") throw new HttpError(403, "Chỉ Manager mới được thêm khách hàng");
    const id = await transaction(async client => {
      await client.query("SELECT crm_kiem_tra_quyen($1, ARRAY['manager']::vai_tro[])", [session.id]);
      return createCustomerAccount(client, body, session.id);
    });
    json(response, 201, { id });
    return true;
  }
  const customerUpdate = path.match(/^\/internal\/customers\/(\d+)$/);
  if (method === "PATCH" && customerUpdate) {
    if (session.role !== "manager") throw new HttpError(403, "Chỉ Manager mới được sửa hồ sơ khách hàng");
    const customerId = requireInteger(customerUpdate[1], "Mã khách hàng");
    const fullName = requireValue(body.hoTen, "Họ và tên", { min: 2, max: 150 });
    const birthYear = requireInteger(body.namSinh, "Năm sinh", 1900, new Date().getFullYear());
    const preferenceId = requireInteger(body.soThichId, "Sở thích");
    const gender = body.gioiTinh;
    if (!["nam", "nu", "khac", "khong_cung_cap"].includes(gender)) throw new HttpError(400, "Giới tính không hợp lệ");
    await transaction(async client => {
      await client.query("SELECT crm_kiem_tra_quyen($1, ARRAY['manager']::vai_tro[])", [session.id]);
      const customer = await client.query(
        `SELECT t.id FROM tai_khoan t JOIN khach_hang h ON h.tai_khoan_id = t.id
          WHERE t.id = $1 AND t.vai_tro = 'customer' FOR UPDATE OF t, h`,
        [customerId]
      );
      if (!customer.rowCount) throw new HttpError(404, "Không tìm thấy hồ sơ khách hàng");
      const preference = await client.query("SELECT id FROM nhom_so_thich WHERE id = $1 AND dang_su_dung", [preferenceId]);
      if (!preference.rowCount) throw new HttpError(400, "Sở thích không tồn tại hoặc đã ngừng sử dụng");
      await client.query(
        `UPDATE khach_hang SET ho_ten = $2, nam_sinh = $3, gioi_tinh = $4, so_thich_id = $5
          WHERE tai_khoan_id = $1`,
        [customerId, fullName, birthYear, gender, preferenceId]
      );
    });
    json(response, 200, { message: "Đã cập nhật hồ sơ khách hàng" });
    return true;
  }
  const customerStatus = path.match(/^\/internal\/customers\/(\d+)\/status$/);
  if (method === "PATCH" && customerStatus) {
    if (session.role !== "admin") throw new HttpError(403, "Manager cần gửi yêu cầu Admin để khóa khách hàng");
    const status = body.status;
    if (!["active", "locked"].includes(status)) throw new HttpError(400, "Trạng thái không hợp lệ");
    await pool.query("SELECT crm_dat_trang_thai_khach_hang($1, $2, $3::trang_thai_tai_khoan)", [
      session.id, requireInteger(customerStatus[1], "Mã khách hàng"), status
    ]);
    json(response, 200, { message: "Đã cập nhật trạng thái khách hàng" });
    return true;
  }
  if (method === "GET" && path === "/internal/reports/customers") {
    const [ages, preferences] = await Promise.all([
      pool.query(`SELECT nhom_tuoi AS label, so_khach_hang AS count, ty_le_phan_tram AS percentage
                    FROM v_bao_cao_do_tuoi ORDER BY thu_tu`),
      pool.query(`SELECT ten_nhom AS label, so_khach_hang AS count, ty_le_phan_tram AS percentage
                    FROM v_bao_cao_so_thich ORDER BY id`)
    ]);
    json(response, 200, { ages: ages.rows, preferences: preferences.rows });
    return true;
  }
  if (method === "GET" && path === "/internal/feedback") {
    const { rows } = await pool.query(
      `SELECT p.id, h.ho_ten AS "customerName", d.ten_do_uong AS "drinkName",
              p.so_sao AS rating, p.noi_dung AS content, p.trang_thai AS status,
              p.phan_hoi_cua_nhan_vien AS reply, p.ngay_gui AS "sentAt"
         FROM phan_hoi p JOIN khach_hang h ON h.tai_khoan_id = p.khach_hang_id
         JOIN do_uong d ON d.id = p.do_uong_id ORDER BY p.ngay_gui DESC`
    );
    json(response, 200, { feedback: rows });
    return true;
  }
  const feedbackUpdate = path.match(/^\/internal\/feedback\/(\d+)$/);
  if (method === "PATCH" && feedbackUpdate) {
    const id = requireInteger(feedbackUpdate[1], "Mã phản hồi");
    const status = body.status;
    if (!["da_xem", "da_tiep_thu"].includes(status)) throw new HttpError(400, "Trạng thái xử lý không hợp lệ");
    const reply = body.reply == null ? "" : requireValue(body.reply, "Nội dung trả lời", { min: 0, max: 2000 });
    if (reply && reply.length < 3) throw new HttpError(400, "Nội dung trả lời phải có ít nhất 3 ký tự");
    if (status === "da_tiep_thu" && !reply) throw new HttpError(400, "Vui lòng nhập nội dung phản hồi trước khi tiếp thu");
    await transaction(async client => {
      const result = await client.query(
        `SELECT khach_hang_id FROM phan_hoi WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!result.rowCount) throw new HttpError(404, "Không tìm thấy phản hồi");
      await client.query("SELECT crm_xu_ly_phan_hoi($1, $2, $3::trang_thai_phan_hoi)", [session.id, id, status]);
      await client.query(
        `UPDATE phan_hoi SET phan_hoi_cua_nhan_vien = $2, ngay_phan_hoi = clock_timestamp() WHERE id = $1`,
        [id, reply]
      );
      if (reply) {
        await client.query(
          `INSERT INTO thong_bao(tai_khoan_id, loai, tieu_de, noi_dung, lien_ket)
           VALUES ($1, 'feedback_reply', 'Phản hồi của bạn đã được trả lời', $2, 'my-feedback')`,
          [result.rows[0].khach_hang_id, reply]
        );
      }
    });
    json(response, 200, { message: "Đã cập nhật phản hồi" });
    return true;
  }
  if (method === "GET" && path === "/internal/surveys") {
    const { rows } = await pool.query(
      `SELECT k.id, k.tieu_de AS title, k.mo_ta AS description, k.trang_thai AS status,
              k.ngay_ket_thuc AS "endAt", k.da_an AS hidden,
              count(p.khach_hang_id)::int AS recipients,
              count(p.ngay_hoan_thanh)::int AS completed,
              coalesce(round(100.0 * count(p.ngay_hoan_thanh) / nullif(count(p.khach_hang_id), 0), 2), 0) AS "completionRate"
         FROM khao_sat k LEFT JOIN phan_phoi_khao_sat p ON p.khao_sat_id = k.id
        GROUP BY k.id ORDER BY k.ngay_tao DESC`
    );
    json(response, 200, { surveys: rows });
    return true;
  }
  const surveyPath = path.match(/^\/internal\/surveys\/(\d+)$/);
  if ((method === "GET" || method === "PATCH") && surveyPath) {
    const id = requireInteger(surveyPath[1], "Mã khảo sát");
    if (method === "GET") {
      const { rows } = await pool.query(
        `SELECT k.id, k.tieu_de AS title, k.mo_ta AS description, k.trang_thai AS status,
                k.ngay_ket_thuc AS "endAt", k.da_an AS hidden,
                count(p.ngay_hoan_thanh)::int AS completed,
                count(p.khach_hang_id)::int AS recipients
           FROM khao_sat k LEFT JOIN phan_phoi_khao_sat p ON p.khao_sat_id = k.id
          WHERE k.id = $1 GROUP BY k.id`,
        [id]
      );
      if (!rows[0]) throw new HttpError(404, "Không tìm thấy khảo sát");
      const questions = await getSurveyQuestions(pool, id);
      json(response, 200, { survey: { ...rows[0], questions } });
      return true;
    }
    const title = requireValue(body.title, "Tiêu đề", { min: 3, max: 255 });
    const endAt = requireDate(body.endAt, "Hạn khảo sát", { allowPast: true });
    const questions = normalizeQuestions(body.questions);
    await transaction(async client => {
      const { rows } = await client.query(`SELECT trang_thai, ngay_ket_thuc FROM khao_sat WHERE id = $1 FOR UPDATE`, [id]);
      if (!rows[0]) throw new HttpError(404, "Không tìm thấy khảo sát");
      const currentQuestions = await getSurveyQuestions(client, id);
      const updatedQuestions = questions.map((question, index) => ({
        ...question,
        required: body.questions[index]?.required === undefined
          ? currentQuestions[index]?.required ?? question.required
          : question.required
      }));
      const questionsChanged = JSON.stringify(updatedQuestions.map(({ content, choices, required }) => ({ content, choices, required }))) !==
        JSON.stringify(currentQuestions.map(({ content, choices, required }) => ({ content, choices, required })));
      if (questionsChanged) {
        const completed = await client.query(
          `SELECT count(*)::int AS count FROM phan_phoi_khao_sat WHERE khao_sat_id = $1 AND ngay_hoan_thanh IS NOT NULL`,
          [id]
        );
        if (Number(completed.rows[0].count) > 0) {
          throw new HttpError(409, "Không thể sửa câu hỏi sau khi đã có phản hồi hoàn thành");
        }
      }
      let updatedEndAt = endAt;
      if (rows[0].trang_thai !== "nhap") {
        const oldEndAt = rows[0].ngay_ket_thuc ? new Date(rows[0].ngay_ket_thuc).getTime() : null;
        const newEndAt = endAt ? new Date(endAt).getTime() : null;
        if ((oldEndAt === null) !== (newEndAt === null) ||
            (oldEndAt !== null && Math.floor(oldEndAt / 60_000) !== Math.floor(newEndAt / 60_000))) {
          throw new HttpError(409, "Không thể thay đổi hạn sau khi khảo sát đã phát hành");
        }
        updatedEndAt = rows[0].ngay_ket_thuc;
      }
      await client.query(`UPDATE khao_sat SET tieu_de = $2, ngay_ket_thuc = $3 WHERE id = $1`, [id, title, updatedEndAt]);
      if (questionsChanged) {
        await client.query(
          `DELETE FROM lua_chon WHERE cau_hoi_id IN (SELECT id FROM cau_hoi WHERE khao_sat_id = $1)`,
          [id]
        );
        await client.query(`DELETE FROM cau_hoi WHERE khao_sat_id = $1`, [id]);
        await addSurveyQuestions(client, id, updatedQuestions);
      }
    });
    json(response, 200, { message: "Đã cập nhật khảo sát" });
    return true;
  }
  const visibility = path.match(/^\/internal\/surveys\/(\d+)\/visibility$/);
  if (method === "PATCH" && visibility) {
    const id = requireInteger(visibility[1], "Mã khảo sát");
    if (typeof body.hidden !== "boolean") throw new HttpError(400, "Trạng thái ẩn/hiện không hợp lệ");
    const result = await pool.query(`UPDATE khao_sat SET da_an = $2 WHERE id = $1`, [id, body.hidden]);
    if (!result.rowCount) throw new HttpError(404, "Không tìm thấy khảo sát");
    json(response, 200, { message: body.hidden ? "Đã ẩn khảo sát" : "Đã khôi phục khảo sát" });
    return true;
  }
  const surveyResults = path.match(/^\/internal\/surveys\/(\d+)\/results$/);
  if (method === "GET" && surveyResults) {
    const id = requireInteger(surveyResults[1], "Mã khảo sát");
    const { rows } = await pool.query(
      `SELECT k.id, k.tieu_de AS title, count(p.khach_hang_id)::int AS recipients,
              count(p.ngay_hoan_thanh)::int AS completed,
              coalesce(round(100.0 * count(p.ngay_hoan_thanh) / nullif(count(p.khach_hang_id), 0), 2), 0) AS "completionRate"
         FROM khao_sat k LEFT JOIN phan_phoi_khao_sat p ON p.khao_sat_id = k.id
        WHERE k.id = $1 GROUP BY k.id`,
      [id]
    );
    if (!rows[0]) throw new HttpError(404, "Không tìm thấy khảo sát");
    const result = await pool.query(
      `SELECT cau_hoi_id, cau_hoi AS content, so_nguoi_tra_loi_cau AS respondents,
              lua_chon AS choice, so_luot_chon AS count, ty_le_phan_tram AS percentage, thu_tu_cau, thu_tu_lua_chon
         FROM v_ket_qua_khao_sat WHERE khao_sat_id = $1 ORDER BY thu_tu_cau, thu_tu_lua_chon`,
      [id]
    );
    const questions = new Map();
    for (const row of result.rows) {
      if (!questions.has(row.cau_hoi_id)) questions.set(row.cau_hoi_id, {
        content: row.content, respondents: Number(row.respondents), choices: []
      });
      questions.get(row.cau_hoi_id).choices.push({
        content: row.choice, count: Number(row.count), percentage: Number(row.percentage || 0)
      });
    }
    json(response, 200, { survey: rows[0], questions: [...questions.values()] });
    return true;
  }
  if (method === "POST" && path === "/internal/surveys") {
    const title = requireValue(body.title, "Tiêu đề", { min: 3, max: 255 });
    const endAt = requireDate(body.endAt, "Hạn khảo sát");
    const questions = normalizeQuestions(body.questions);
    const customerIds = body.customerIds == null ? null : [...new Set(body.customerIds.map((id, index) => requireInteger(id, `Mã khách hàng ${index + 1}`)))];
    if (customerIds && customerIds.length === 0) throw new HttpError(400, "Hãy chọn ít nhất một khách hàng nhận khảo sát");
    const recipients = await transaction(async client => {
      const { rows } = await client.query(
        `INSERT INTO khao_sat(tieu_de, mo_ta, ngay_ket_thuc, nguoi_tao_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [title, body.description ? requireValue(body.description, "Mô tả", { max: 2000 }) : null, endAt, session.id]
      );
      const surveyId = rows[0].id;
      await addSurveyQuestions(client, surveyId, questions);
      const result = await client.query(
        `SELECT crm_phat_hanh_khao_sat($1, $2, $3::bigint[]) AS recipients`,
        [session.id, surveyId, customerIds]
      );
      await client.query(
        `INSERT INTO thong_bao(tai_khoan_id, loai, tieu_de, noi_dung, lien_ket)
         SELECT khach_hang_id, 'survey', 'Khảo sát mới', $2, 'my-surveys'
           FROM phan_phoi_khao_sat WHERE khao_sat_id = $1`,
        [surveyId, body.description ? requireValue(body.description, "Mô tả", { max: 2000 }) : title]
      );
      return Number(result.rows[0].recipients);
    });
    json(response, 201, { recipients });
    return true;
  }
  if (method === "GET" && path === "/internal/managers") {
    if (session.role !== "admin") throw new HttpError(403, "Chỉ Admin mới được quản lý tài khoản Manager");
    const { rows } = await pool.query(
      `SELECT t.id, t.ten_dang_nhap AS username, t.trang_thai AS status,
              t.ngay_tao AS "createdAt", n.ho_ten AS "fullName",
              n.chuc_vu AS "jobTitle", n.bo_phan AS department
         FROM tai_khoan t LEFT JOIN nhan_vien_noi_bo n ON n.tai_khoan_id = t.id
        WHERE t.vai_tro = 'manager' ORDER BY t.ngay_tao DESC`
    );
    json(response, 200, { managers: rows });
    return true;
  }
  if (method === "POST" && path === "/internal/managers") {
    if (session.role !== "admin") throw new HttpError(403, "Chỉ Admin mới được tạo tài khoản Manager");
    const username = requireValue(body.tenDangNhap, "Tên đăng nhập", { min: 3, max: 100 }).toLocaleLowerCase();
    if (!/^[a-z0-9._-]+$/.test(username)) throw new HttpError(400, "Tên đăng nhập chỉ được gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang");
    const password = requirePassword(body.matKhau);
    const fullName = requireValue(body.hoTen, "Họ và tên", { min: 2, max: 150 });
    const jobTitle = requireValue(body.chucVu, "Chức vụ", { min: 2, max: 150 });
    const department = body.boPhan == null || body.boPhan === ""
      ? ""
      : requireValue(body.boPhan, "Bộ phận", { min: 1, max: 150 });
    const passwordHash = await hashPassword(password);
    const managerId = await transaction(async client => {
      await client.query("SELECT crm_kiem_tra_quyen($1, ARRAY['admin']::vai_tro[])", [session.id]);
      const { rows } = await client.query(
        `INSERT INTO tai_khoan(ten_dang_nhap, mat_khau_hash, vai_tro, nguoi_tao_id)
         VALUES ($1, $2, 'manager', $3) RETURNING id`,
        [username, passwordHash, session.id]
      );
      const id = rows[0].id;
      await client.query(
        `INSERT INTO nhan_vien_noi_bo(tai_khoan_id, ho_ten, chuc_vu, bo_phan)
         VALUES ($1, $2, $3, $4)`,
        [id, fullName, jobTitle, department]
      );
      return id;
    });
    json(response, 201, { id: managerId, message: "Đã tạo tài khoản Manager" });
    return true;
  }
  const managerPath = path.match(/^\/internal\/managers\/(\d+)$/);
  if (method === "PATCH" && managerPath) {
    if (session.role !== "admin") throw new HttpError(403, "Chỉ Admin mới được cập nhật tài khoản Manager");
    const managerId = requireInteger(managerPath[1], "Mã Manager");
    const status = body.status;
    if (status !== undefined && !["active", "locked"].includes(status)) throw new HttpError(400, "Trạng thái tài khoản không hợp lệ");
    const fullName = requireValue(body.hoTen, "Họ và tên", { min: 2, max: 150 });
    const jobTitle = requireValue(body.chucVu, "Chức vụ", { min: 2, max: 150 });
    const department = body.boPhan == null || body.boPhan === ""
      ? ""
      : requireValue(body.boPhan, "Bộ phận", { min: 1, max: 150 });
    await transaction(async client => {
      await client.query("SELECT crm_kiem_tra_quyen($1, ARRAY['admin']::vai_tro[])", [session.id]);
      const account = await client.query(
        `UPDATE tai_khoan SET trang_thai = COALESCE($2::trang_thai_tai_khoan, trang_thai)
          WHERE id = $1 AND vai_tro = 'manager' RETURNING id`,
        [managerId, status || null]
      );
      if (!account.rowCount) throw new HttpError(404, "Không tìm thấy tài khoản Manager");
      await client.query(
        `INSERT INTO nhan_vien_noi_bo(tai_khoan_id, ho_ten, chuc_vu, bo_phan)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tai_khoan_id) DO UPDATE
           SET ho_ten = EXCLUDED.ho_ten, chuc_vu = EXCLUDED.chuc_vu,
               bo_phan = EXCLUDED.bo_phan, ngay_cap_nhat = clock_timestamp()`,
        [managerId, fullName, jobTitle, department]
      );
    });
    json(response, 200, { message: "Đã cập nhật thông tin Manager" });
    return true;
  }
  if (method === "GET" && path === "/internal/customer-requests") {
    const result = session.role === "admin"
      ? await pool.query(
        `SELECT r.id, r.khach_hang_id AS "customerId", r.loai AS action, r.ly_do AS reason,
                r.trang_thai AS status, r.ngay_tao AS "createdAt",
                a.ten_dang_nhap AS "requesterUsername", n.ho_ten AS "requesterName",
                COALESCE(h.ho_ten, r.khach_hang_ten) AS "customerName", r.ghi_chu_quyet_dinh AS "decisionNote",
                r.ngay_quyet_dinh AS "decidedAt"
           FROM yeu_cau_admin_khach_hang r
           JOIN tai_khoan a ON a.id = r.nguoi_yeu_cau_id
           LEFT JOIN nhan_vien_noi_bo n ON n.tai_khoan_id = a.id
           LEFT JOIN khach_hang h ON h.tai_khoan_id = r.khach_hang_id
           WHERE r.loai IN ('lock_customer', 'unlock_customer')
           ORDER BY (r.trang_thai = 'pending') DESC, r.ngay_tao DESC`
      )
      : await pool.query(
        `SELECT r.id, r.khach_hang_id AS "customerId", r.loai AS action, r.ly_do AS reason,
                r.trang_thai AS status, r.ngay_tao AS "createdAt",
                COALESCE(h.ho_ten, r.khach_hang_ten) AS "customerName", r.ghi_chu_quyet_dinh AS "decisionNote",
                r.ngay_quyet_dinh AS "decidedAt"
           FROM yeu_cau_admin_khach_hang r
           LEFT JOIN khach_hang h ON h.tai_khoan_id = r.khach_hang_id
          WHERE r.nguoi_yeu_cau_id = $1 AND r.loai IN ('lock_customer', 'unlock_customer') ORDER BY r.ngay_tao DESC`,
        [session.id]
      );
    json(response, 200, { requests: result.rows });
    return true;
  }
  if (method === "POST" && path === "/internal/customer-requests") {
    if (session.role !== "manager") throw new HttpError(403, "Chỉ Manager mới được gửi yêu cầu lên Admin");
    const customerId = requireInteger(body.customerId, "Mã khách hàng");
    const action = body.action || "lock_customer";
    if (!["lock_customer", "unlock_customer"].includes(action)) throw new HttpError(400, "Loại yêu cầu không hợp lệ");
    const isUnlock = action === "unlock_customer";
    const reason = requireValue(body.reason, isUnlock ? "Lý do mở khóa" : "Lý do khóa", { min: 5, max: 2000 });
    const rows = await transaction(async client => {
      await client.query("SELECT crm_kiem_tra_quyen($1, ARRAY['manager']::vai_tro[])", [session.id]);
      const target = await client.query(
        `SELECT t.id, t.trang_thai AS status, h.ho_ten AS name
           FROM tai_khoan t JOIN khach_hang h ON h.tai_khoan_id = t.id
          WHERE t.id = $1 AND t.vai_tro = 'customer' FOR UPDATE OF t, h`,
        [customerId]
      );
      if (!target.rowCount) throw new HttpError(404, "Không tìm thấy khách hàng");
      if (isUnlock) {
        if (target.rows[0].status !== "locked") {
          throw new HttpError(409, "Chỉ có thể yêu cầu mở khóa khách hàng đang bị khóa");
        }
      } else {
        if (target.rows[0].status !== "active") {
          throw new HttpError(409, "Chỉ có thể yêu cầu khóa khách hàng đang hoạt động");
        }
      }
      const existingRequest = await client.query(
        `SELECT id FROM yeu_cau_admin_khach_hang
          WHERE khach_hang_id = $1 AND loai = 'lock_customer' AND trang_thai = 'pending' LIMIT 1`,
        [customerId]
      );
      if (existingRequest.rowCount) {
        throw new HttpError(409, isUnlock ? "Đã có yêu cầu mở khóa đang chờ Admin xử lý" : "Đã có yêu cầu khóa đang chờ Admin xử lý");
      }
      const result = await client.query(
        `INSERT INTO yeu_cau_admin_khach_hang(nguoi_yeu_cau_id, khach_hang_id, khach_hang_ten, loai, ly_do)
         VALUES ($1, $2, $3, 'lock_customer', $4) RETURNING id`,
        [session.id, customerId, target.rows[0].name, reason]
      );
      return result.rows;
    });
    if (!rows[0]) throw new HttpError(404, "Không tìm thấy khách hàng");
    json(response, 201, {
      id: rows[0].id,
      message: isUnlock ? "Đã gửi đề xuất mở khóa đến Admin" : "Đã gửi đề xuất khóa đến Admin"
    });
    return true;
  }
  const requestDecision = path.match(/^\/internal\/customer-requests\/(\d+)$/);
  if (method === "PATCH" && requestDecision) {
    if (session.role !== "admin") throw new HttpError(403, "Chỉ Admin mới được quyết định yêu cầu");
    const requestId = requireInteger(requestDecision[1], "Mã yêu cầu");
    const status = body.status;
    if (!["approved", "rejected"].includes(status)) throw new HttpError(400, "Quyết định không hợp lệ");
    const note = body.note == null || body.note === "" ? null : requireValue(body.note, "Ghi chú", { min: 1, max: 2000 });
    let resolvedAction = "lock_customer";
    await transaction(async client => {
      await client.query("SELECT crm_kiem_tra_quyen($1, ARRAY['admin']::vai_tro[])", [session.id]);
      const { rows: candidates } = await client.query(
        `SELECT id, khach_hang_id, loai, trang_thai
           FROM yeu_cau_admin_khach_hang WHERE id = $1`,
        [requestId]
      );
      const candidate = candidates[0];
      if (!candidate) throw new HttpError(404, "Không tìm thấy yêu cầu");
      if (candidate.trang_thai !== "pending") throw new HttpError(409, "Yêu cầu này đã được xử lý");
      if (!["lock_customer", "unlock_customer"].includes(candidate.loai)) throw new HttpError(409, "Loại yêu cầu này không còn được hỗ trợ");
      resolvedAction = candidate.loai;
      const { rows: lockedRequests } = await client.query(
        `SELECT id, khach_hang_id, loai, trang_thai
           FROM yeu_cau_admin_khach_hang WHERE id = $1 FOR UPDATE`,
        [requestId]
      );
      const pending = lockedRequests[0];
      if (!pending) throw new HttpError(404, "Không tìm thấy yêu cầu");
      if (pending.trang_thai !== "pending") throw new HttpError(409, "Yêu cầu này đã được xử lý");
      if (pending.khach_hang_id !== candidate.khach_hang_id || pending.loai !== candidate.loai) {
        throw new HttpError(409, "Yêu cầu đã thay đổi; vui lòng tải lại danh sách");
      }
      if (status === "approved") {
        const targetStatus = pending.loai === "unlock_customer" ? "active" : "locked";
        await client.query(
          "SELECT crm_dat_trang_thai_khach_hang($1, $2, $3::trang_thai_tai_khoan)",
          [session.id, pending.khach_hang_id, targetStatus]
        );
      }
      await client.query(
        `UPDATE yeu_cau_admin_khach_hang
            SET trang_thai = $2, nguoi_quyet_dinh_id = $3, ghi_chu_quyet_dinh = $4,
                ngay_quyet_dinh = clock_timestamp()
          WHERE id = $1`,
        [requestId, status, session.id, note]
      );
    });
    json(response, 200, {
      message: status === "rejected"
        ? "Đã từ chối yêu cầu"
        : (resolvedAction === "unlock_customer" ? "Đã phê duyệt và mở khóa khách hàng" : "Đã phê duyệt và khóa khách hàng")
    });
    return true;
  }
  if (method === "GET" && path === "/internal/accounts") {
    if (session.role !== "admin") throw new HttpError(403, "Chỉ Admin mới được xem tài khoản nội bộ");
    const { rows } = await pool.query(
      `SELECT id, ten_dang_nhap AS username, vai_tro AS role, trang_thai AS status, ngay_tao AS "createdAt"
         FROM tai_khoan WHERE vai_tro <> 'customer' ORDER BY ngay_tao DESC`
    );
    json(response, 200, { accounts: rows });
    return true;
  }
  if (method === "GET" && path === "/internal/catalogs") {
    const [preferences, drinks] = await Promise.all([
      pool.query(`SELECT id, ten_nhom AS name, mo_ta AS description, dang_su_dung AS active FROM nhom_so_thich ORDER BY id`),
      pool.query(`SELECT id, ma_do_uong AS code, ten_do_uong AS name, mo_ta AS description, dang_kinh_doanh AS active FROM do_uong ORDER BY id`)
    ]);
    json(response, 200, { preferences: preferences.rows, drinks: drinks.rows });
    return true;
  }
  if (method === "POST" && path === "/internal/drinks") {
    if (!['manager', 'admin'].includes(session.role)) throw new HttpError(403, "Bạn không có quyền thêm đồ uống");
    const code = requireValue(body.maDoUong, "Mã đồ uống", { min: 2, max: 30 }).toLocaleUpperCase();
    if (!/^[A-Z0-9_-]+$/.test(code)) throw new HttpError(400, "Mã đồ uống chỉ gồm chữ in hoa, số, gạch ngang hoặc gạch dưới");
    const name = requireValue(body.tenDoUong, "Tên đồ uống", { min: 2, max: 150 });
    const description = body.moTa == null || body.moTa.trim() === "" ? null : requireValue(body.moTa, "Mô tả", { max: 1000 });
    const { rows } = await pool.query(
      `INSERT INTO do_uong(ma_do_uong, ten_do_uong, mo_ta, dang_kinh_doanh)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [code, name, description]
    );
    json(response, 201, { id: rows[0].id, message: "Đã thêm đồ uống mới" });
    return true;
  }
  const drinkStatusPath = path.match(/^\/internal\/drinks\/(\d+)\/status$/);
  if (method === "PATCH" && drinkStatusPath) {
    if (!["manager", "admin"].includes(session.role)) throw new HttpError(403, "Bạn không có quyền cập nhật đồ uống");
    const id = requireInteger(drinkStatusPath[1], "Mã đồ uống");
    if (typeof body.active !== "boolean") throw new HttpError(400, "Trạng thái kinh doanh không hợp lệ");
    const { rowCount } = await pool.query(
      `UPDATE do_uong SET dang_kinh_doanh = $2 WHERE id = $1`,
      [id, body.active]
    );
    if (!rowCount) throw new HttpError(404, "Không tìm thấy đồ uống");
    json(response, 200, { message: body.active ? "Đã mở bán lại đồ uống" : "Đã ngừng bán đồ uống" });
    return true;
  }
  return false;
}

async function handle(request, response) {
  const origin = request.headers.origin;
  if (origin && config.frontendOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");

  if (request.method === "OPTIONS") {
    if (origin && !config.frontendOrigins.includes(origin)) {
      json(response, 403, { code: "ORIGIN_NOT_ALLOWED", message: "Nguồn truy cập không được phép" });
      return;
    }
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const body = ["POST", "PATCH", "PUT"].includes(request.method) ? await readJson(request) : {};

    if (request.method === "GET" && path === "/health") {
      await pool.query("SELECT 1");
      json(response, 200, { service: "milktea-coffee-api", status: "ok", database: "connected" });
      return;
    }
    if (await customerRoutes(request, response, request.method, path, body)) return;
    if (await internalRoutes(request, response, request.method, path, body)) return;
    json(response, 404, { code: "NOT_FOUND", message: "Endpoint không tồn tại" });
  } catch (error) {
    const handled = mapDatabaseError(error);
    json(response, handled.status, { code: handled.status >= 500 ? "SERVER_ERROR" : "REQUEST_ERROR", message: handled.message });
  }
}

if (config.authSecret.length < 32 || /thay-bang|change-this|example/i.test(config.authSecret)) {
  console.error("AUTH_SECRET cần là chuỗi bí mật riêng, ngẫu nhiên và dài ít nhất 32 ký tự trong api/.env.");
  process.exit(1);
}

const server = createServer((request, response) => {
  handle(request, response);
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`milktea-coffee API đang chạy tại http://localhost:${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(async () => {
    await pool.end();
    process.exit(0);
  }));
}
