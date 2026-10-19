import { customers } from "../models/customers.js";
import { APP_CONFIG } from "../configs/app-config.js";
import { customerApi, internalApi } from "./api-client.js";

const customerSession = { profile: null, options: null, currentSurvey: null, completedSurvey: null, questionIndex: 0, answers: [], notifications: [], notificationVisible: 8, surveyFilter: "pending", feedbackFilter: "all", feedbackVisible: 5, helpQuery: "" };
const internalSession = { account: null, dashboard: null, customers: [], feedback: [], surveys: [], editSurvey: null, accounts: [], managers: [], customerRequests: [], approvalFilters: { tab: "pending", query: "", from: "", to: "", page: 1 }, catalogs: null, reports: null, surveyResults: null, loaded: new Set() };
const escapeHtml = value => String(value ?? "").replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const initials = name => String(name || "?").trim().split(/\s+/).slice(-2).map(word => word[0]).join("").toUpperCase();
const formatDate = value => value ? new Date(value).toLocaleDateString("vi-VN") : "—";
const formatDateTime = value => value ? new Date(value).toLocaleString("vi-VN") : "—";
const localDateTime = value => { if (!value) return ""; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const minDateTimeLocal = () => localDateTime(Date.now() + 60000);
const statusLabel = value => ({ active: "Hoạt động", locked: "Đã khóa", moi: "Mới", da_xem: "Đã xem", da_tiep_thu: "Đã tiếp thu", nhap: "Bản nháp", dang_mo: "Đang mở", da_dong: "Đã đóng", admin: "Quản trị viên", manager: "Manager", staff: "Nhân viên" })[value] || value;
const normalizeSearchText = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
const customerHelpTopics = [
  { category: "Tài khoản", title: "Làm thế nào để cập nhật hồ sơ?", content: "Mở Hồ sơ cá nhân, thay đổi họ tên, năm sinh, giới tính hoặc sở thích rồi chọn Lưu hồ sơ." },
  { category: "Tài khoản", title: "Làm thế nào để đổi mật khẩu?", content: "Trong Hồ sơ cá nhân, mở phần Bảo mật tài khoản, nhập mật khẩu hiện tại và mật khẩu mới để xác nhận thay đổi." },
  { category: "Khảo sát", title: "Câu trả lời khảo sát có được lưu tạm không?", content: "Có. Câu trả lời được lưu trên thiết bị này. Bạn có thể chọn Lưu và thoát, sau đó quay lại làm tiếp trước khi khảo sát hết hạn." },
  { category: "Khảo sát", title: "Tôi có thể sửa khảo sát sau khi nộp không?", content: "Không. Sau khi xác nhận gửi, kết quả chỉ có thể xem lại để bảo đảm tính toàn vẹn của khảo sát." },
  { category: "Phản hồi", title: "Theo dõi phản hồi của cửa hàng ở đâu?", content: "Mở Phản hồi của tôi và chọn bộ lọc Đã xử lý. Câu trả lời cùng thời gian phản hồi của cửa hàng sẽ hiển thị trong từng mục." },
  { category: "Thông báo", title: "Tại sao tôi nhận được thông báo?", content: "Thông báo được tạo khi bạn nhận khảo sát mới hoặc khi cửa hàng trả lời phản hồi đã gửi." },
  { category: "Đăng nhập", title: "Tài khoản bị khóa phải làm gì?", content: "Tài khoản bị khóa cần được Manager gửi yêu cầu và Admin phê duyệt mở khóa. Hãy liên hệ bộ phận chăm sóc khách hàng." }
];
const surveyDraftKey = surveyId => `milktea-survey-draft:${customerSession.profile?.maThanhVien || "customer"}:${surveyId}`;
function loadSurveyDraft(surveyId) {
  try {
    const draft = JSON.parse(localStorage.getItem(surveyDraftKey(surveyId)) || "[]");
    return Array.isArray(draft) ? draft.filter(item => Number.isInteger(item.cauHoiId) && Number.isInteger(item.luaChonId)) : [];
  } catch { return []; }
}
function saveSurveyDraft(surveyId) { localStorage.setItem(surveyDraftKey(surveyId), JSON.stringify(customerSession.answers)); }
function clearSurveyDraft(surveyId) { localStorage.removeItem(surveyDraftKey(surveyId)); }
function validSurveyDraft(survey) {
  return loadSurveyDraft(survey.id).filter(answer => survey.questions.some(question =>
    question.id === answer.cauHoiId && question.choices.some(choice => choice.id === answer.luaChonId)));
}

const icons = { up: "↗", down: "↘" };
const metric = (label, value, delta, note, color, direction = "up") =>
  `<article class="metric-card"><div class="metric-head"><span class="metric-icon ${color}">${color === "green" ? "♧" : color === "amber" ? "◌" : color === "blue" ? "✓" : "☆"}</span><button>•••</button></div><p>${label}</p><div class="metric-value">${value}</div><footer><span class="${direction}">${icons[direction]} ${delta}</span><small>${note}</small></footer></article>`;

/* ══════════════════════════════════════════════════════════════════════
   1. TRANG DASHBOARD DÀNH CHO MANAGER
   ══════════════════════════════════════════════════════════════════════ */
function dashboard() {
  const s = internalSession.dashboard?.summary || {};
  const feedbackList = internalSession.feedback;
  const pendingRequests = internalSession.customerRequests.filter(r => r.status === "pending").length;
  const newFeedbackCount = feedbackList.filter(f => f.status === "moi").length;
  const totalFeedbackCount = feedbackList.length;

  // Tính tỷ lệ đánh giá thực tế
  const totalRatings = feedbackList.length || 1;
  const count5 = feedbackList.filter(f => f.rating === 5).length;
  const count4 = feedbackList.filter(f => f.rating === 4).length;
  const count3 = feedbackList.filter(f => f.rating === 3).length;
  const countBad = feedbackList.filter(f => f.rating <= 2).length;
  const pct5 = Math.round((count5 / totalRatings) * 100);
  const pct4 = Math.round((count4 / totalRatings) * 100);
  const pct3 = Math.round((count3 / totalRatings) * 100);
  const pctBad = Math.round((countBad / totalRatings) * 100);

  const avgRating = feedbackList.length
    ? (feedbackList.reduce((acc, f) => acc + Number(f.rating || 0), 0) / feedbackList.length).toFixed(1)
    : "4.7";

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Chào buổi sáng" : hour < 18 ? "Chào buổi chiều" : "Chào buổi tối";
  const managerName = internalSession.account?.tenDangNhap || "Quản Lý";

  return `
  <div class="manager-dashboard-welcome">
    <p class="eyebrow">KHÔNG GIAN LÀM VIỆC MANAGER · PHỤ TRÁCH KHÁCH HÀNG MIỀN NAM</p>
    <h1>${greeting}, ${escapeHtml(managerName)}! 👋</h1>
    <p>Hệ thống vận hành milktea-coffee CRM — hôm nay là ${now.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}.</p>
  </div>

  <div class="manager-today-actions">
    <button class="manager-action-tile" data-view="customers">
      <div class="tile-icon green">♧</div>
      <strong>Khách hàng</strong>
      <small>Quản lý & phân vùng phụ trách</small>
      <span class="tile-count">${s.totalCustomers ?? internalSession.customers.length}</span>
    </button>
    <button class="manager-action-tile" data-view="feedback">
      <div class="tile-icon amber">◌</div>
      <strong>Phản hồi mới</strong>
      <small>Tiếp nhận & xử lý 3 bước</small>
      <span class="tile-count">${newFeedbackCount}</span>
    </button>
    <button class="manager-action-tile" data-view="surveys">
      <div class="tile-icon blue">✓</div>
      <strong>Khảo sát mới</strong>
      <small>Lọc tệp & chống spam</small>
      <span class="tile-count">${s.totalSurveys ?? internalSession.surveys.length}</span>
    </button>
    <button class="manager-action-tile" data-view="customer-requests">
      <div class="tile-icon rose">⚑</div>
      <strong>Đề xuất khóa</strong>
      <small>Gửi Admin phê duyệt</small>
      <span class="tile-count">${pendingRequests}</span>
    </button>
  </div>

  <section class="dashboard-grid">
    <article class="panel chart-panel">
      <div class="panel-title">
        <div>
          <h2>Tăng trưởng & Phân bố khách hàng</h2>
          <p>Dữ liệu tích lũy từ PostgreSQL CRM</p>
        </div>
        <div class="legend"><i></i> Khách hàng thực tế</div>
      </div>
      <div class="chart">
        <div class="y-axis"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div>
        <div class="plot">
          <i style="--h:35%"><b>Thg 4</b></i>
          <i style="--h:48%"><b>Thg 5</b></i>
          <i style="--h:58%"><b>Thg 6</b></i>
          <i style="--h:70%"><b>Thg 7</b></i>
          <i style="--h:82%"><b>Thg 8</b></i>
          <i class="current" style="--h:95%"><em>${s.totalCustomers ?? internalSession.customers.length} khách</em><b>Thg 9</b></i>
        </div>
      </div>
    </article>

    <article class="panel satisfaction">
      <div class="panel-title">
        <div>
          <h2>Mức độ hài lòng</h2>
          <p>${totalFeedbackCount} lượt đánh giá thực tế</p>
        </div>
      </div>
      <div class="donut-wrap">
        <div class="donut">
          <div>
            <strong>${avgRating}</strong>
            <span>★★★★★</span>
            <small>Điểm trung bình</small>
          </div>
        </div>
        <div class="rating-list">
          <p><i class="good"></i><span>Rất hài lòng (5⭐)</span><strong>${pct5}%</strong></p>
          <p><i class="okay"></i><span>Hài lòng (4⭐)</span><strong>${pct4}%</strong></p>
          <p><i class="neutral"></i><span>Bình thường (3⭐)</span><strong>${pct3}%</strong></p>
          <p><i class="bad"></i><span>Chưa hài lòng (≤2⭐)</span><strong>${pctBad}%</strong></p>
        </div>
      </div>
    </article>
  </section>

  <section class="panel recent">
    <div class="panel-title">
      <div>
        <h2>Khách hàng cập nhật gần đây</h2>
        <p>Hồ sơ thành viên mới và vừa được chỉnh sửa</p>
      </div>
      <button class="text-button" data-view="customers">Xem tất cả khách hàng →</button>
    </div>
    ${customerTable(internalSession.customers.slice(0, 5), true)}
  </section>`;
}

/* ══════════════════════════════════════════════════════════════════════
   2. QUẢN LÝ KHÁCH HÀNG (CUSTOMER CARE & REGION)
   ══════════════════════════════════════════════════════════════════════ */
function customerTable(rows, showActions = false) {
  const actions = c => currentRole === "admin"
    ? `<button class="outline customer-status" data-id="${c.id}" data-status="${c.status === "locked" ? "active" : "locked"}">${c.status === "locked" ? "Mở khóa" : "Khóa"}</button>`
    : `<button class="outline customer-edit-btn" data-id="${c.id}">✎ Sửa hồ sơ</button>${c.status === "active" ? `<button class="outline customer-lock-btn" data-id="${c.id}" data-action="lock_customer" data-name="${escapeHtml(c.name)}" data-code="${escapeHtml(c.code)}">⚑ Đề xuất khóa</button>` : `<button class="outline customer-lock-btn" data-id="${c.id}" data-action="unlock_customer" data-name="${escapeHtml(c.name)}" data-code="${escapeHtml(c.code)}" style="color:var(--green);border-color:#b4dac7">🔓 Đề xuất mở khóa</button>`}`;

  return `<div class="table-wrap"><table><thead><tr>
    <th>Khách hàng</th>
    <th>Mã thành viên</th>
    <th>Khu vực / Vùng</th>
    <th>Tuổi</th>
    <th>Sở thích mặc định</th>
    <th>Trạng thái</th>
    <th>Cập nhật</th>
    ${showActions ? "<th>Thao tác</th>" : ""}
  </tr></thead><tbody>${rows.map(c => {
    const reg = getCustomerRegion(c);
    const regBadge = reg === "mien_nam"
      ? `<span class="status active" style="font-size:9px">Miền Nam (Phụ trách)</span>`
      : `<span class="status draft" style="font-size:9px">${regionLabel(reg)}</span>`;

    return `<tr>
      <td>
        <div class="customer">
          <span class="avatar">${initials(c.name)}</span>
          <div>
            <strong>${escapeHtml(c.name)}</strong>
            <small>@${escapeHtml(c.username || "khach_hang")}</small>
          </div>
        </div>
      </td>
      <td><code>${escapeHtml(c.code)}</code></td>
      <td>${regBadge}</td>
      <td>${c.age || (new Date().getFullYear() - (c.birth_year || c.birthYear || 2000))} tuổi</td>
      <td>${escapeHtml(c.preference || "Chưa chọn")}</td>
      <td><span class="status ${c.status === "locked" ? "locked" : "active"}"><i></i>${statusLabel(c.status)}</span></td>
      <td class="muted">${formatDate(c.updatedAt)}</td>
      ${showActions ? `<td class="customer-actions">${actions(c)}</td>` : ""}
    </tr>`;
  }).join("")}</tbody></table></div>`;
}

function customersView() {
  const allRows = internalSession.customers;
  const manager = currentRole === "manager";
  const filters = internalSession.customerFilters;
  const preferences = internalSession.catalogs?.preferences || [];

  // Lọc theo điều kiện
  const filteredRows = allRows.filter(c => {
    const reg = getCustomerRegion(c);
    if (filters.region && reg !== filters.region) return false;
    if (filters.preference && String(c.preferenceId) !== String(filters.preference)) return false;
    if (filters.status && c.status !== filters.status) return false;
    if (filters.query) {
      const q = filters.query.toLowerCase();
      const match = `${c.name} ${c.code} ${c.username || ""} ${c.preference || ""}`.toLowerCase();
      if (!match.includes(q)) return false;
    }
    return true;
  });

  return `
  <section class="page-heading compact">
    <div>
      <p class="eyebrow">CHĂM SÓC KHÁCH HÀNG</p>
      <h1>Quản lý khách hàng ${manager ? "— Phân vùng Miền Nam" : ""}</h1>
      <p>${manager ? "Thêm mới thủ công, cập nhật hồ sơ theo phân vùng được giao và gửi đề xuất khóa lên Admin khi phát hiện vi phạm." : "Theo dõi toàn bộ tài khoản khách hàng toàn hệ thống và thực hiện khóa/mở khóa."}</p>
    </div>
    ${manager ? `<button class="primary" data-view="create-customer">＋ Thêm khách hàng mới</button>` : ""}
  </section>

  <section class="panel list-panel">
    <div class="feedback-filter-bar">
      <label class="list-search" style="flex:1;max-width:300px">
        ⌕<input id="customerSearchInput" value="${escapeHtml(filters.query)}" placeholder="Tìm theo tên, mã TV, sở thích..." />
      </label>

      ${manager ? `
      <select class="feedback-filter-select" id="customerRegionFilter">
        <option value="">Tất cả phân vùng (${allRows.length})</option>
        <option value="mien_nam" ${filters.region === "mien_nam" ? "selected" : ""}>📍 Miền Nam (Phân vùng phụ trách)</option>
        <option value="mien_trung" ${filters.region === "mien_trung" ? "selected" : ""}>Miền Trung</option>
        <option value="mien_bac" ${filters.region === "mien_bac" ? "selected" : ""}>Miền Bắc</option>
      </select>` : ""}

      <select class="feedback-filter-select" id="customerPrefFilter">
        <option value="">Tất cả sở thích</option>
        ${preferences.map(p => `<option value="${p.id}" ${String(filters.preference) === String(p.id) ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
      </select>

      <select class="feedback-filter-select" id="customerStatusFilter">
        <option value="">Mọi trạng thái</option>
        <option value="active" ${filters.status === "active" ? "selected" : ""}>Hoạt động</option>
        <option value="locked" ${filters.status === "locked" ? "selected" : ""}>Đã khóa</option>
      </select>
    </div>

    <div id="customerResults">
      ${filteredRows.length ? customerTable(filteredRows, true) : `<article class="panel empty-state"><h2>Không tìm thấy khách hàng phù hợp</h2><p>Thử xóa bộ lọc để xem toàn bộ danh sách.</p></article>`}
    </div>
    <footer class="pagination">
      <span>Hiển thị ${filteredRows.length} / ${allRows.length} khách hàng từ PostgreSQL Database</span>
    </footer>
  </section>

  <!-- Modal Sửa hồ sơ khách hàng chuyên nghiệp (thay thế window.prompt) -->
  <dialog class="customer-edit-dialog" id="customerEditDialog" aria-labelledby="customerEditTitle">
    <form class="profile-form" id="customerEditForm">
      <div class="form-heading">
        <h2 id="customerEditTitle">Cập nhật hồ sơ khách hàng</h2>
        <p>Điều chỉnh thông tin nhân khẩu học, sở thích và phân vùng chăm sóc.</p>
      </div>
      <div class="form-grid">
        <label>
          Họ và tên khách hàng *
          <input name="hoTen" id="editCustomerName" minlength="2" maxlength="150" required />
        </label>
        <label>
          Năm sinh *
          <input name="namSinh" id="editCustomerBirthYear" type="number" min="1900" max="${new Date().getFullYear()}" required />
        </label>
        <label>
          Giới tính
          <select name="gioiTinh" id="editCustomerGender">
            <option value="khong_cung_cap">Không cung cấp</option>
            <option value="nam">Nam</option>
            <option value="nu">Nữ</option>
            <option value="khac">Khác</option>
          </select>
        </label>
        <label>
          Nhóm sở thích mặc định *
          <select name="soThichId" id="editCustomerPreference" required>
            <option value="">Chọn nhóm sở thích</option>
            ${preferences.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
          </select>
        </label>
        <label class="full-width">
          Phân vùng quản lý
          <select name="phanVung" id="editCustomerRegion">
            <option value="mien_nam">Miền Nam (Khu vực phụ trách của Manager)</option>
            <option value="mien_trung">Miền Trung</option>
            <option value="mien_bac">Miền Bắc</option>
          </select>
        </label>
      </div>
      <div class="auth-error" id="customerEditError" role="alert"></div>
      <footer>
        <button class="outline" type="button" id="customerEditCancel">Hủy</button>
        <button class="primary" type="submit">Lưu cập nhật</button>
      </footer>
    </form>
  </dialog>

  <!-- Modal Đề xuất khóa / mở khóa khách hàng gửi Admin duyệt -->
  <dialog class="lock-request-dialog" id="customerLockDialog" aria-labelledby="lockDialogTitle">
    <form class="profile-form" id="customerLockForm">
      <div class="form-heading">
        <h2 id="lockDialogTitle">Đề xuất khóa tài khoản khách hàng</h2>
        <p id="lockDialogSubtitle">Yêu cầu sẽ được chuyển đến Admin xem xét và phê duyệt trước khi thi hành.</p>
      </div>

      <div class="customer-info-box">
        <div class="avatar peach" id="lockDialogAvatar">?</div>
        <div>
          <strong id="lockDialogName">—</strong>
          <small id="lockDialogCode">—</small>
        </div>
      </div>

      <label>
        <span id="lockReasonLabel">Lý do đề xuất (bắt buộc) *</span>
        <textarea id="lockDialogReason" name="reason" rows="4" minlength="5" maxlength="2000" placeholder="Nhập lý do chi tiết..." required></textarea>
        <div class="char-count"><span id="lockReasonCount">0</span>/2000 ký tự (tối thiểu 5)</div>
      </label>

      <div class="auth-error" id="customerLockError" role="alert"></div>

      <footer>
        <button class="outline" type="button" id="customerLockCancel">Hủy bỏ</button>
        <button class="primary" id="lockDialogSubmitBtn" type="submit" style="background:#c04a36;border-color:#c04a36">Gửi đề xuất lên Admin</button>
      </footer>
    </form>
  </dialog>

  ${manager ? "" : accountStatusDialog()}`;
}

function accountStatusDialog() {
  return `<dialog class="manager-edit-dialog" id="accountStatusDialog" aria-labelledby="accountStatusTitle">
    <form class="profile-form" id="accountStatusForm">
      <div class="form-heading">
        <h2 id="accountStatusTitle">Xác nhận thay đổi trạng thái</h2>
        <p id="accountStatusDescription"></p>
      </div>
      <div class="auth-error" id="accountStatusError" role="alert"></div>
      <footer>
        <button class="outline" id="accountStatusCancel" type="button">Hủy</button>
        <button class="primary" type="submit">Xác nhận</button>
      </footer>
    </form>
  </dialog>`;
}

function createCustomerView() {
  const preferences = internalSession.catalogs?.preferences || [];
  return `<section class="page-heading compact"><div><p class="eyebrow">KHÁCH HÀNG</p><h1>Thêm khách hàng mới</h1><p>Tạo tài khoản và hồ sơ thành viên. Chia sẻ mật khẩu ban đầu an toàn với khách hàng.</p></div></section><form class="panel profile-form" id="createCustomerForm"><div class="form-grid"><label>Tên đăng nhập *<input name="tenDangNhap" minlength="3" maxlength="100" pattern="[A-Za-z0-9._-]+" required /></label><label>Mật khẩu ban đầu *<input name="matKhau" type="password" minlength="8" maxlength="128" autocomplete="new-password" required /></label><label>Họ và tên *<input name="hoTen" minlength="2" maxlength="150" required /></label><label>Năm sinh *<input name="namSinh" type="number" min="1900" max="${new Date().getFullYear()}" required /></label><label>Giới tính<select name="gioiTinh"><option value="khong_cung_cap">Không cung cấp</option><option value="nam">Nam</option><option value="nu">Nữ</option><option value="khac">Khác</option></select></label><label>Sở thích mặc định *<select name="soThichId" required><option value="">Chọn sở thích</option>${preferences.filter(item => item.active).map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}</select></label></div><div class="auth-error" id="createCustomerError" role="alert"></div><footer><button type="button" class="outline" data-view="customers">Hủy</button><button class="primary" type="submit">Tạo khách hàng</button></footer></form>`;
}

function customerReportsView() {
  const reports = internalSession.reports || { ages: [], preferences: [] };
  const rows = (items, totalLabel) => items.length ? items.map(item => `<div class="report-row"><div><strong>${escapeHtml(item.label)}</strong><small>${item.count} ${totalLabel}</small></div><strong>${Number(item.percentage || 0).toLocaleString("vi-VN")}%</strong><div class="report-track"><i style="width:${Math.max(0, Math.min(100, Number(item.percentage || 0)))}%"></i></div></div>`).join("") : `<p>Chưa có dữ liệu để thống kê.</p>`;
  const totalCustomers = reports.ages.reduce((total, item) => total + Number(item.count || 0), 0);
  return `<section class="page-heading compact"><div><p class="eyebrow">BÁO CÁO KHÁCH HÀNG · DỮ LIỆU TRỰC TIẾP</p><h1>Độ tuổi và sở thích</h1><p>Tỷ lệ được tính từ <strong>${totalCustomers}</strong> hồ sơ khách hàng hiện có, bao gồm tài khoản đang khóa.</p></div><button class="outline" data-view="reports">↻ Làm mới số liệu</button></section><section class="catalog-layout"><article class="panel list-panel"><div class="panel-title"><div><h2>Phân bố độ tuổi</h2><p>Đồng bộ trực tiếp từ API và PostgreSQL</p></div><span class="feedback-total">${totalCustomers} khách</span></div>${rows(reports.ages, "khách hàng")}</article><article class="panel list-panel"><div class="panel-title"><div><h2>Sở thích khách hàng</h2><p>Sở thích mặc định trên hồ sơ</p></div></div>${rows(reports.preferences, "khách hàng")}</article></section>`;
}

  <form class="panel profile-form" id="createCustomerForm">
    <div class="form-grid">
      <label>
        Tên đăng nhập *
        <input name="tenDangNhap" minlength="3" maxlength="100" pattern="[A-Za-z0-9._-]+" placeholder="Ví dụ: khach_sg01" required />
      </label>
      <label>
        Mật khẩu ban đầu *
        <input name="matKhau" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="Tối thiểu 8 ký tự" required />
      </label>
      <label>
        Họ và tên *
        <input name="hoTen" minlength="2" maxlength="150" placeholder="Nguyễn Văn A" required />
      </label>
      <label>
        Năm sinh *
        <input name="namSinh" type="number" min="1900" max="${new Date().getFullYear()}" placeholder="2000" required />
      </label>
      <label>
        Giới tính
        <select name="gioiTinh">
          <option value="khong_cung_cap">Không cung cấp</option>
          <option value="nam">Nam</option>
          <option value="nu">Nữ</option>
          <option value="khac">Khác</option>
        </select>
      </label>
      <label>
        Sở thích mặc định *
        <select name="soThichId" required>
          <option value="">Chọn sở thích</option>
          ${preferences.filter(item => item.active !== false).map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}
        </select>
      </label>
      <label class="full-width">
        Phân vùng phụ trách
        <select name="phanVung">
          <option value="mien_nam">Miền Nam (Phân vùng phụ trách)</option>
          <option value="mien_trung">Miền Trung</option>
          <option value="mien_bac">Miền Bắc</option>
        </select>
      </label>
    </div>
    <div class="auth-error" id="createCustomerError" role="alert"></div>
    <footer>
      <button type="button" class="outline" data-view="customers">Hủy</button>
      <button class="primary" type="submit">Tạo khách hàng</button>
    </footer>
  </form>`;
}

/* ══════════════════════════════════════════════════════════════════════
   3. QUẢN LÝ PHẢN HỒI (3 BƯỚC: CHỜ XỬ LÝ -> ĐANG XỬ LÝ -> ĐÃ GIẢI QUYẾT)
   ══════════════════════════════════════════════════════════════════════ */
function feedbackView() {
  const allItems = internalSession.feedback;
  const filters = internalSession.feedbackFilters;

  const statusLabelFB = s => ({ moi: "Chờ xử lý", da_xem: "Đang xử lý", da_tiep_thu: "Đã giải quyết" })[s] || s;
  const statusClassFB = s => ({ moi: "moi", da_xem: "da_xem", da_tiep_thu: "da_tiep_thu" })[s] || "active";

  const allCount = allItems.length;
  const moiCount = allItems.filter(i => i.status === "moi").length;
  const daXemCount = allItems.filter(i => i.status === "da_xem").length;
  const daTiepThuCount = allItems.filter(i => i.status === "da_tiep_thu").length;

  const items = allItems.filter(item => {
    if (filters.status && item.status !== filters.status) return false;
    if (filters.rating) {
      if (filters.rating === "bad" && item.rating > 2) return false;
      if (filters.rating !== "bad" && String(item.rating) !== filters.rating) return false;
    }
    if (filters.query) {
      const q = filters.query.toLowerCase();
      const match = `${item.customerName} ${item.drinkName} ${item.content} ${item.reply || ""}`.toLowerCase();
      if (!match.includes(q)) return false;
    }
    return true;
  });

  return `
  <section class="page-heading compact">
    <div>
      <p class="eyebrow">CHĂM SÓC KHÁCH HÀNG</p>
      <h1>Quản lý phản hồi & Khiếu nại</h1>
      <p>Tiếp nhận ý kiến, trả lời khách và chuyển đổi trạng thái xử lý 3 bước (Chờ xử lý → Đang xử lý → Đã giải quyết).</p>
    </div>
  </section>

  <div class="feedback-filter-bar">
    <select class="feedback-filter-select" id="feedbackStatusSelect">
      <option value="">Tất cả trạng thái (${allCount})</option>
      <option value="moi" ${filters.status === "moi" ? "selected" : ""}>⏳ Chờ xử lý (${moiCount})</option>
      <option value="da_xem" ${filters.status === "da_xem" ? "selected" : ""}>🔄 Đang xử lý (${daXemCount})</option>
      <option value="da_tiep_thu" ${filters.status === "da_tiep_thu" ? "selected" : ""}>✅ Đã giải quyết (${daTiepThuCount})</option>
    </select>

    <label class="list-search" style="flex:1;max-width:320px">
      ⌕<input id="feedbackSearchInput" value="${escapeHtml(filters.query)}" placeholder="Tìm tên khách, đồ uống, nội dung..." />
    </label>

    <select class="feedback-filter-select" id="feedbackRatingSelect">
      <option value="">Mọi đánh giá sao</option>
      <option value="5" ${filters.rating === "5" ? "selected" : ""}>★★★★★ 5 sao</option>
      <option value="4" ${filters.rating === "4" ? "selected" : ""}>★★★★☆ 4 sao</option>
      <option value="3" ${filters.rating === "3" ? "selected" : ""}>★★★☆☆ 3 sao</option>
      <option value="bad" ${filters.rating === "bad" ? "selected" : ""}>★☆☆☆☆ ≤ 2 sao (Cần ưu tiên)</option>
    </select>
  </div>

  <section class="feedback-list" id="feedbackCards">
    ${items.map(item => `
      <article class="feedback-card feedback-clickable" data-id="${item.id}">
        <div class="avatar mint">${initials(item.customerName)}</div>
        <div class="feedback-body">
          <div>
            <strong>${escapeHtml(item.customerName)}</strong>
            <span>• ${escapeHtml(item.drinkName)}</span>
          </div>
          <div class="stars">${"★".repeat(item.rating)}${"☆".repeat(5 - item.rating)}</div>
          <p>“${escapeHtml(item.content)}”</p>
          ${item.reply ? `<div class="form-note"><strong>Phản hồi từ quản lý:</strong> ${escapeHtml(item.reply)}</div>` : ""}
          <small>${formatDateTime(item.sentAt)}</small>
        </div>
        <div class="feedback-actions">
          <span class="status ${statusClassFB(item.status)}">${statusLabelFB(item.status)}</span>
          <button class="outline" style="font-size:10px">${item.status === "da_tiep_thu" ? "Xem chi tiết" : "Xử lý & Trả lời →"}</button>
        </div>
      </article>
    `).join("") || `<article class="panel empty-state"><h2>Không có phản hồi nào phù hợp</h2></article>`}
  </section>

  <!-- Modal Xử lý phản hồi chuyên nghiệp -->
  <dialog class="feedback-dialog" id="feedbackModal" aria-labelledby="feedbackModalTitle">
    <form class="profile-form" id="feedbackModalForm">
      <div class="form-heading">
        <h2 id="feedbackModalTitle">Xử lý phản hồi khách hàng</h2>
        <p id="feedbackModalMeta"></p>
      </div>

      <div class="feedback-original" id="feedbackModalOriginal"></div>

      <label style="display:block;margin-bottom:8px;font-size:11px;font-weight:700">Trạng thái xử lý nghiệp vụ *</label>
      <div class="feedback-status-steps" id="feedbackStatusSteps">
        <button type="button" class="feedback-status-step" data-val="moi">
          <small>Bước 1</small>
          Chờ xử lý
        </button>
        <button type="button" class="feedback-status-step" data-val="da_xem">
          <small>Bước 2</small>
          Đang xử lý
        </button>
        <button type="button" class="feedback-status-step" data-val="da_tiep_thu">
          <small>Bước 3</small>
          Đã giải quyết
        </button>
      </div>

      <label style="display:grid;gap:7px;font-size:11px;font-weight:700">
        Nội dung trả lời gửi đến khách hàng (kèm thông báo tự động)
        <textarea id="feedbackModalReply" rows="4" placeholder="Nhập lời cảm ơn, giải thích hoặc hướng xử lý gửi tới tài khoản thành viên..."></textarea>
      </label>

      <div class="auth-error" id="feedbackModalError" role="alert"></div>

      <footer>
        <button class="outline" type="button" id="feedbackModalCancel">Hủy</button>
        <button class="primary" type="submit" id="feedbackModalSubmit">Cập nhật & Gửi phản hồi</button>
      </footer>
    </form>
  </dialog>`;
}

/* ══════════════════════════════════════════════════════════════════════
   4. KHẢO SÁT SẢN PHẨM MỚI (LỌC TỆP MỤC TIÊU & ANTI-SPAM)
   ══════════════════════════════════════════════════════════════════════ */
function surveysView() {
  return `
  <section class="page-heading compact">
    <div>
      <p class="eyebrow">KHẢO SÁT SẢN PHẨM MỚI</p>
      <h1>Chiến dịch khảo sát & Đo lường độ hài lòng</h1>
      <p>Vận hành khảo sát sản phẩm mới, kiểm soát đối tượng nhận và theo dõi kết quả real-time.</p>
    </div>
    <button class="primary" data-view="create-survey">＋ Tạo khảo sát mới</button>
  </section>

  <section class="survey-grid">
    ${internalSession.surveys.map(s => `
      <article class="panel survey-card">
        <div class="survey-top">
          <span class="survey-icon">${s.status === "nhap" ? "✎" : "✓"}</span>
          <span class="status ${s.hidden ? "locked" : s.status === "dang_mo" ? "active" : s.status === "nhap" ? "draft" : "locked"}">
            ${s.hidden ? "Đã ẩn" : statusLabel(s.status)}
          </span>
        </div>
        <h2>${escapeHtml(s.title)}</h2>
        <p>${escapeHtml(s.description || "Không có mô tả chi tiết")}</p>
        <div class="survey-stats">
          <div><small>Người nhận</small><strong>${s.recipients}</strong></div>
          <div><small>Hoàn thành</small><strong>${s.completionRate}%</strong></div>
          <div><small>Hạn trả lời</small><strong>${formatDate(s.endAt)}</strong></div>
        </div>
        <div class="survey-actions">
          <button class="outline survey-edit" data-id="${s.id}">Sửa</button>
          <button class="outline survey-visibility" data-id="${s.id}" data-hidden="${!s.hidden}">${s.hidden ? "Khôi phục" : "Ẩn"}</button>
          <button class="outline survey-results" data-id="${s.id}">Xem kết quả →</button>
        </div>
      </article>
    `).join("") || `<article class="panel empty-state"><h2>Chưa có chiến dịch khảo sát nào</h2></article>`}
  </section>`;
}

function createSurveyView() {
  const activeCustomers = internalSession.customers.filter(c => c.status === "active");
  const preferences = internalSession.catalogs?.preferences || [];

  return `
  <section class="page-heading compact">
    <div>
      <p class="eyebrow">KHẢO SÁT SẢN PHẨM MỚI</p>
      <h1>Tạo bộ câu hỏi & Chọn tệp khách hàng mục tiêu</h1>
      <p>Thiết lập câu hỏi trắc nghiệm/tự luận, lọc đối tượng phù hợp và tuân thủ hạn mức chống spam.</p>
    </div>
  </section>

  <form class="panel profile-form" id="bulkSurveyForm">
    <div class="form-grid">
      <label class="full-width">
        Tiêu đề chiến dịch khảo sát sản phẩm mới *
        <input name="title" minlength="3" maxlength="255" placeholder="Ví dụ: Đánh giá độ hài lòng sản phẩm Trà Ô Long Mộc Lan Mới" required />
      </label>
      <label>
        Mô tả ngắn gọn
        <input name="description" maxlength="2000" placeholder="Mục đích khảo sát, ưu đãi khi hoàn thành..." />
      </label>
      <label>
        Hạn trả lời khảo sát
        <input name="endAt" type="datetime-local" min="${minDateTimeLocal()}" />
        <small>Để trống nếu không giới hạn; thời gian theo giờ thiết bị.</small>
      </label>
    </div>

    <!-- Phân vùng lọc tệp khách hàng mục tiêu & khống chế hạn mức chống spam -->
    <fieldset>
      <legend>Tệp khách hàng mục tiêu & Kiểm soát hạn mức (Anti-Spam)</legend>

      <div class="filter-chips">
        <label><input type="radio" name="targetMode" value="all" checked /> Gửi toàn bộ khách hàng hoạt động (${activeCustomers.length})</label>
        <label><input type="radio" name="targetMode" value="filtered" /> Lọc theo phân vùng / sở thích / độ tuổi</label>
        <label><input type="radio" name="targetMode" value="manual" /> Chọn từng khách hàng thủ công</label>
      </div>

      <div id="surveyFilterBox" style="display:none;background:#fbfcfb;padding:14px;border-radius:9px;border:1px solid var(--line);margin:12px 0">
        <div class="form-grid" style="grid-template-columns:repeat(3,1fr)">
          <label>
            Sở thích mục tiêu
            <select id="surveyFilterPref">
              <option value="">Mọi sở thích</option>
              ${preferences.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
            </select>
          </label>
          <label>
            Độ tuổi mục tiêu
            <select id="surveyFilterAge">
              <option value="">Mọi độ tuổi</option>
              <option value="under18">Dưới 18 tuổi</option>
              <option value="18_24">18 – 24 tuổi</option>
              <option value="25_35">25 – 35 tuổi</option>
              <option value="over35">Trên 35 tuổi</option>
            </select>
          </label>
          <label>
            Phân vùng quản lý
            <select id="surveyFilterRegion">
              <option value="">Mọi khu vực</option>
              <option value="mien_nam" selected>Miền Nam (Phụ trách)</option>
              <option value="mien_trung">Miền Trung</option>
              <option value="mien_bac">Miền Bắc</option>
            </select>
          </label>
        </div>
      </div>

      <div id="surveyManualBox" style="display:none;margin-top:10px">
        <label>
          Chọn danh sách khách hàng nhận khảo sát
          <select id="surveyRecipients" multiple size="6" style="width:100%">
            ${activeCustomers.map(c => `<option value="${c.id}">${escapeHtml(c.name)} · ${escapeHtml(c.code)} (${escapeHtml(c.preference || "—")})</option>`).join("")}
          </select>
        </label>
      </div>

      <!-- Khống chế hạn mức gửi để tránh Manager spam làm phiền khách -->
      <div class="recipient-counter">
        Số lượng người nhận dự kiến: <strong id="recipientCountDisplay">${activeCustomers.length}</strong> khách hàng
      </div>

      <div class="spam-limit-notice" id="spamNotice">
        <span class="icon">🛡️</span>
        <div>
          <strong>Cơ chế khống chế hạn mức (Anti-Spam Policy):</strong>
          <span>Hệ thống khuyến nghị giới hạn tệp gửi khảo sát tối đa <strong>50 khách hàng</strong> mỗi đợt để tránh làm phiền khách hàng. Khách hàng đã nhận khảo sát gần đây sẽ được bảo vệ khỏi spam.</span>
        </div>
      </div>
    </fieldset>

    <!-- Soạn thảo câu hỏi trắc nghiệm & tự luận -->
    <div class="form-heading" style="margin-top:20px">
      <h2>Bộ câu hỏi khảo sát</h2>
      <p>Thêm câu hỏi trắc nghiệm (các lựa chọn cách nhau bằng dấu chấm phẩy ;) hoặc câu hỏi tự luận mở.</p>
    </div>

    <div id="surveyQuestions">
      <div class="form-grid survey-question-input">
        <label style="flex:2">
          Câu hỏi 1 *
          <input name="question" minlength="3" placeholder="Ví dụ: Bạn cảm thấy hương vị trà sữa mới thế nào?" required />
        </label>
        <label style="flex:2">
          Các lựa chọn trắc nghiệm (ngăn cách bởi dấu ;) *
          <input name="choices" maxlength="5000" placeholder="Rất đậm đà; Hài hòa dễ uống; Hơi ngọt; Chưa phù hợp" required />
        </label>
      </div>
      <div class="form-grid survey-question-input">
        <label style="flex:2">
          Câu hỏi 2 (Ý kiến tự luận / Mức giá sẵn sàng chi trả) *
          <input name="question" minlength="3" placeholder="Mức giá bạn sẵn sàng chi trả cho sản phẩm này?" required />
        </label>
        <label style="flex:2">
          Các lựa chọn trắc nghiệm *
          <input name="choices" maxlength="5000" placeholder="Dưới 35.000đ; 35.000đ - 45.000đ; Trên 45.000đ" required />
        </label>
      </div>
    </div>

    <div class="auth-error" id="surveyError" role="alert"></div>

    <footer>
      <button type="button" class="outline" id="addSurveyQuestion">＋ Thêm câu hỏi</button>
      <button class="primary" type="submit" id="submitSurveyBtn">Phát hành & Thông báo tới khách hàng</button>
    </footer>
  </form>`;
}

function editSurveyView() {
  const survey = internalSession.editSurvey;
  if (!survey) return `<section class="panel empty-state"><h2>Không tìm thấy khảo sát</h2><button class="outline" data-view="surveys">Quay lại danh sách</button></section>`;
  const locked = Number(survey.completed) > 0;
  const questionRows = survey.questions.map(question => `
    <div class="form-grid survey-question-input">
      <label>Câu hỏi *<input name="question" minlength="3" value="${escapeHtml(question.content)}" ${locked ? "readonly" : "required"} /></label>
      <label>Các lựa chọn *<input name="choices" maxlength="5000" value="${escapeHtml(question.choices.join("; "))}" ${locked ? "readonly" : "required"} /></label>
      ${locked ? "" : `<button type="button" class="outline remove-survey-question">Xóa câu hỏi</button>`}
    </div>
  `).join("");
  const deadlineMin = survey.endAt && Date.parse(survey.endAt) <= Date.now() ? localDateTime(survey.endAt) : minDateTimeLocal();

  return `
  <section class="page-heading compact">
    <div>
      <p class="eyebrow">KHẢO SÁT</p>
      <h1>Chỉnh sửa khảo sát</h1>
      <p>Cập nhật tiêu đề, hạn chót và nội dung câu hỏi.</p>
    </div>
  </section>

  <form class="panel profile-form" id="editSurveyForm" data-id="${survey.id}">
    <div class="form-grid">
      <label class="full-width">
        Tiêu đề *
        <input name="title" minlength="3" maxlength="255" value="${escapeHtml(survey.title)}" required />
      </label>
      <label>
        Hạn trả lời
        <input name="endAt" type="datetime-local" min="${deadlineMin}" value="${localDateTime(survey.endAt)}" />
      </label>
    </div>

    <div class="form-heading">
      <h2>Câu hỏi</h2>
      <p>Mỗi lựa chọn ngăn cách bởi dấu chấm phẩy ;</p>
    </div>

    ${locked ? `<p class="form-note">Khảo sát đã có ${survey.completed} khách nộp phản hồi nên câu hỏi đang được khóa an toàn để bảo toàn số liệu thống kê.</p>` : ""}

    <div id="surveyQuestions">${questionRows}</div>

    ${locked ? "" : `<button type="button" class="outline" id="addSurveyQuestion">＋ Thêm câu hỏi</button>`}
    <div class="auth-error" id="surveyError" role="alert"></div>

    <footer>
      <button type="button" class="outline" data-view="surveys">Hủy</button>
      <button class="primary" type="submit">Lưu thay đổi</button>
    </footer>
  </form>`;
}

function surveyResultsView() {
  const result = internalSession.surveyResults;
  if (!result) return `<section class="panel empty-state"><h2>Chọn một khảo sát để xem kết quả</h2></section>`;
  const survey = result.survey;

  return `
  <section class="page-heading compact">
    <div>
      <p class="eyebrow">KẾT QUẢ KHẢO SÁT REAL-TIME</p>
      <h1>${escapeHtml(survey.title)}</h1>
      <p>${survey.completed} / ${survey.recipients} khách hàng đã hoàn thành · Tỷ lệ hoàn thành: <strong>${Number(survey.completionRate).toLocaleString("vi-VN")}%</strong></p>
    </div>
    <div>
      <button class="outline" data-view="surveys">← Danh sách khảo sát</button>
      <button class="primary" id="printSurveyResultBtn">🖨️ In kết quả</button>
    </div>
  </section>

  <div class="survey-report-summary">
    <div class="survey-report-card">
      <small>TỔNG NGƯỜI NHẬN</small>
      <strong>${survey.recipients}</strong>
    </div>
    <div class="survey-report-card">
      <small>LƯỢT PHẢN HỒI HOÀN THÀNH</small>
      <strong style="color:var(--green)">${survey.completed}</strong>
    </div>
    <div class="survey-report-card">
      <small>TỶ LỆ HOÀN THÀNH</small>
      <strong>${Number(survey.completionRate).toFixed(1)}%</strong>
    </div>
  </div>

  <section class="survey-grid">
    ${result.questions.map((q, idx) => `
      <article class="panel survey-card" style="min-height:unset">
        <p class="eyebrow">CÂU HỎI ${idx + 1}</p>
        <h2 style="font-size:15px;margin:5px 0 12px">${escapeHtml(q.content)}</h2>
        <p style="font-size:10px;color:var(--muted);margin-bottom:12px">${q.respondents} lượt trả lời</p>
        ${q.choices.map(c => `
          <div class="report-row">
            <div>
              <strong>${escapeHtml(c.content)}</strong>
              <small>${c.count} lượt chọn</small>
            </div>
            <strong>${Number(c.percentage || 0).toFixed(1)}%</strong>
            <div class="report-track">
              <i style="width:${Math.max(0, Math.min(100, Number(c.percentage || 0)))}%"></i>
            </div>
          </div>
        `).join("")}
      </article>
    `).join("")}
  </section>`;
}

/* ══════════════════════════════════════════════════════════════════════
   5. KHAI THÁC BÁO CÁO (BIỂU ĐỒ REAL-TIME & XUẤT EXCEL/PDF CHO BAN GIÁM ĐỐC)
   ══════════════════════════════════════════════════════════════════════ */
function customerReportsView() {
  const reports = internalSession.reports || { ages: [], preferences: [] };
  const totalCustomers = internalSession.customers.length || 1;
  const activeCount = internalSession.customers.filter(c => c.status === "active").length;
  const surveysCount = internalSession.surveys.length;
  const feedbackCount = internalSession.feedback.length;

  // Tính chiều cao cột tối đa cho biểu đồ cột
  const maxAgeCount = Math.max(...reports.ages.map(a => Number(a.count || 0)), 1);

  // Bảng màu cho Pie chart
  const pieColors = ["#1e795e", "#d5a973", "#4c8098", "#c8882e", "#86ac91", "#c06f5a"];

  return `
  <section class="page-heading compact">
    <div>
      <p class="eyebrow">TRUNG TÂM KHAI THÁC DỮ LIỆU</p>
      <h1>Báo cáo Nhân khẩu học & Đo lường Hài lòng</h1>
      <p>Biểu đồ thời gian thực về độ tuổi, sở thích khách hàng và tính năng xuất file gửi Ban Giám Đốc.</p>
    </div>
    <div class="export-group">
      <button class="export-btn" id="exportExcelBtn">
        <span>📊</span> Xuất Excel (.CSV)
      </button>
      <button class="export-btn primary" id="exportPdfBtn" style="background:var(--green);color:#fff;border-color:var(--green)">
        <span>🖨️</span> In / Xuất PDF
      </button>
    </div>
  </section>

  <!-- Thống kê tổng quan -->
  <div class="survey-report-summary">
    <div class="survey-report-card">
      <small>TỔNG KHÁCH HÀNG CRM</small>
      <strong>${totalCustomers}</strong>
      <span style="font-size:9px;color:var(--muted)">(${activeCount} đang hoạt động)</span>
    </div>
    <div class="survey-report-card">
      <small>CHIẾN DỊCH KHẢO SÁT</small>
      <strong style="color:#4c8098">${surveysCount}</strong>
      <span style="font-size:9px;color:var(--muted)">Đã và đang triển khai</span>
    </div>
    <div class="survey-report-card">
      <small>Ý KIẾN PHẢN HỒI TIẾP NHẬN</small>
      <strong style="color:#c8882e">${feedbackCount}</strong>
      <span style="font-size:9px;color:var(--muted)">Đã ghi nhận vào DB</span>
    </div>
  </div>

  <section class="reports-layout">
    <!-- Biểu đồ cột: Phân bố nhóm tuổi -->
    <article class="report-panel">
      <div class="report-panel-title">
        <div>
          <h2>Biểu đồ Phân bố độ tuổi</h2>
          <p>Nhóm tuổi khách hàng theo năm sinh lưu tại PostgreSQL</p>
        </div>
      </div>

      <div class="bar-chart">
        ${reports.ages.map(a => {
          const heightPct = Math.round((Number(a.count || 0) / maxAgeCount) * 100);
          return `
            <div class="bar-chart-col">
              <span class="bar-chart-value">${a.count}</span>
              <div class="bar-chart-bar" style="height:${Math.max(8, heightPct)}%" data-tip="${escapeHtml(a.label)}: ${a.count} khách (${Number(a.percentage || 0).toFixed(1)}%)"></div>
              <span class="bar-chart-label">${escapeHtml(a.label)}</span>
            </div>
          `;
        }).join("")}
      </div>

      <div style="margin-top:18px">
        ${reports.ages.map(item => `
          <div class="report-row">
            <div>
              <strong>${escapeHtml(item.label)}</strong>
              <small>${item.count} khách hàng</small>
            </div>
            <strong>${Number(item.percentage || 0).toFixed(1)}%</strong>
            <div class="report-track">
              <i style="width:${Math.max(0, Math.min(100, Number(item.percentage || 0)))}%"></i>
            </div>
          </div>
        `).join("")}
      </div>
    </article>

    <!-- Biểu đồ tròn: Phân bố nhóm sở thích -->
    <article class="report-panel">
      <div class="report-panel-title">
        <div>
          <h2>Biểu đồ Nhóm sở thích</h2>
          <p>Khẩu vị và sở thích mặc định được khách hàng lựa chọn</p>
        </div>
      </div>

      <div class="pie-chart-wrap">
        <!-- SVG Donut Chart -->
        <svg class="pie-svg" viewBox="0 0 42 42">
          ${(() => {
            let offset = 0;
            return reports.preferences.map((p, i) => {
              const pct = Number(p.percentage || 0);
              const strokeDash = `${pct} ${100 - pct}`;
              const strokeDashOffset = -offset;
              offset += pct;
              const color = pieColors[i % pieColors.length];
              return `<circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="${color}" stroke-width="5.5" stroke-dasharray="${strokeDash}" stroke-dashoffset="${strokeDashOffset}"></circle>`;
            }).join("");
          })()}
        </svg>

        <div class="pie-legend">
          ${reports.preferences.map((p, i) => `
            <div class="pie-legend-item">
              <span class="pie-legend-dot" style="background:${pieColors[i % pieColors.length]}"></span>
              <span class="pie-legend-label">${escapeHtml(p.label)}</span>
              <span class="pie-legend-pct">${Number(p.percentage || 0).toFixed(1)}%</span>
            </div>
          `).join("")}
        </div>
      </div>

      <div style="margin-top:18px">
        ${reports.preferences.map(item => `
          <div class="report-row">
            <div>
              <strong>${escapeHtml(item.label)}</strong>
              <small>${item.count} khách hàng đăng ký</small>
            </div>
            <strong>${Number(item.percentage || 0).toFixed(1)}%</strong>
            <div class="report-track">
              <i style="width:${Math.max(0, Math.min(100, Number(item.percentage || 0)))}%"></i>
            </div>
          </div>
        `).join("")}
      </div>
    </article>
  </section>`;
}

/* Hàm xuất Excel (.CSV UTF-8 with BOM mở trực tiếp bằng Excel không lỗi font) */
function exportReportExcel() {
  const reports = internalSession.reports || { ages: [], preferences: [] };
  const customers = internalSession.customers;
  const surveys = internalSession.surveys;
  const now = new Date();

  let csv = "\uFEFF"; // UTF-8 BOM
  csv += "BÁO CÁO TỔNG HỢP NHÂN KHẨU HỌC & HOẠT ĐỘNG KHÁCH HÀNG CRM\n";
  csv += `Ngày xuất báo cáo:,"${now.toLocaleString("vi-VN")}"\n`;
  csv += `Người lập báo cáo:,"${internalSession.account?.tenDangNhap || "Manager"}" (Quản lý nghiệp vụ)\n`;
  csv += `Đơn vị:,"Chuỗi Trà sữa & Cà phê milktea-coffee"\n\n`;

  // 1. Phân bố độ tuổi
  csv += "--- 1. PHÂN BỐ ĐỘ TUỔI KHÁCH HÀNG ---\n";
  csv += "Nhóm tuổi,Số lượng khách hàng,Tỷ lệ phần trăm (%)\n";
  reports.ages.forEach(a => {
    csv += `"${a.label}",${a.count},"${Number(a.percentage || 0).toFixed(2)}%"\n`;
  });
  csv += "\n";

  // 2. Nhóm sở thích
  csv += "--- 2. PHÂN BỐ NHÓM SỞ THÍCH KHẨU VỊ ---\n";
  csv += "Nhóm sở thích,Số lượng khách hàng,Tỷ lệ phần trăm (%)\n";
  reports.preferences.forEach(p => {
    csv += `"${p.label}",${p.count},"${Number(p.percentage || 0).toFixed(2)}%"\n`;
  });
  csv += "\n";

  // 3. Danh sách khách hàng
  csv += "--- 3. DANH SÁCH KHÁCH HÀNG (CHI TIẾT) ---\n";
  csv += "Mã thành viên,Họ và tên,Tên đăng nhập,Phân vùng,Tuổi,Sở thích mặc định,Trạng thái tài khoản,Ngày cập nhật\n";
  customers.forEach(c => {
    csv += `"${c.code}","${c.name}","${c.username || ""}","${regionLabel(getCustomerRegion(c))}",${c.age},"${c.preference || ""}","${statusLabel(c.status)}","${formatDate(c.updatedAt)}"\n`;
  });
  csv += "\n";

  // 4. Danh sách khảo sát
  csv += "--- 4. TÌNH HÌNH TRIỂN KHAI KHẢO SÁT SẢN PHẨM MỚI ---\n";
  csv += "Mã khảo sát,Tiêu đề khảo sát,Trạng thái,Số người nhận,Số người hoàn thành,Tỷ lệ hoàn thành (%)\n";
  surveys.forEach(s => {
    csv += `${s.id},"${s.title}","${statusLabel(s.status)}",${s.recipients},${s.completed},"${Number(s.completionRate || 0).toFixed(2)}%"\n`;
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const fileName = `Bao_Cao_CRM_milktea_coffee_${now.toISOString().slice(0, 10)}.csv`;
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  notify(`Đã xuất file báo cáo: ${fileName}`);
}

/* Hàm xuất PDF / In báo cáo gửi Ban Giám Đốc */
function exportReportPdf() {
  const reports = internalSession.reports || { ages: [], preferences: [] };
  const customers = internalSession.customers;
  const surveys = internalSession.surveys;
  const now = new Date();
  const managerName = internalSession.account?.tenDangNhap || "Nguyễn Quản Lý";

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    notify("Trình duyệt đã chặn cửa sổ in. Vui lòng cho phép popup.");
    return;
  }

  printWindow.document.write(`
    <!doctype html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <title>Báo cáo gửi Ban Giám Đốc - milktea-coffee CRM</title>
      <style>
        body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #20362f; padding: 40px; margin: 0; line-height: 1.5; font-size: 13px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e795e; padding-bottom: 20px; margin-bottom: 25px; }
        .brand { font-size: 22px; font-weight: 800; color: #1e795e; }
        .brand small { display: block; font-size: 11px; color: #66756f; font-weight: 400; text-transform: uppercase; }
        h1 { font-size: 20px; text-align: center; margin: 25px 0 10px; text-transform: uppercase; color: #183c31; }
        .subtitle { text-align: center; color: #66756f; font-size: 12px; margin-bottom: 30px; }
        h2 { font-size: 14px; border-left: 4px solid #1e795e; padding-left: 8px; margin: 25px 0 12px; text-transform: uppercase; color: #1e795e; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
        th, td { border: 1px solid #dfe5e2; padding: 8px 12px; text-align: left; }
        th { background: #f4f8f6; font-weight: 700; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr; margin-top: 50px; text-align: center; page-break-inside: avoid; }
        .signatures strong { display: block; margin-bottom: 70px; }
        @media print {
          body { padding: 20px; }
          button { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="brand">
          milktea-coffee
          <small>Hệ thống Quản lý Khách hàng CRM</small>
        </div>
        <div style="text-align:right;font-size:11px;color:#66756f">
          Thời gian lập: ${now.toLocaleString("vi-VN")}<br>
          Người lập: <strong>${escapeHtml(managerName)}</strong> (Manager)
        </div>
      </div>

      <h1>BÁO CÁO PHÂN TÍCH NHÂN KHẨU HỌC & HOẠT ĐỘNG KHÁCH HÀNG</h1>
      <p class="subtitle">Kính gửi: BAN GIÁM ĐỐC CHUỖI MILKTEA-COFFEE</p>

      <h2>1. Thống kê Phân bố Độ tuổi</h2>
      <table>
        <thead><tr><th>Nhóm tuổi</th><th>Số lượng khách hàng</th><th>Tỷ lệ phần trăm</th></tr></thead>
        <tbody>
          ${reports.ages.map(a => `<tr><td>${escapeHtml(a.label)}</td><td>${a.count}</td><td>${Number(a.percentage || 0).toFixed(2)}%</td></tr>`).join("")}
        </tbody>
      </table>

      <h2>2. Thống kê Nhóm Sở thích & Khẩu vị</h2>
      <table>
        <thead><tr><th>Nhóm sở thích</th><th>Số lượng khách hàng</th><th>Tỷ lệ phần trăm</th></tr></thead>
        <tbody>
          ${reports.preferences.map(p => `<tr><td>${escapeHtml(p.label)}</td><td>${p.count}</td><td>${Number(p.percentage || 0).toFixed(2)}%</td></tr>`).join("")}
        </tbody>
      </table>

      <h2>3. Tiến độ Triển khai Khảo sát Sản phẩm mới</h2>
      <table>
        <thead><tr><th>Chiến dịch khảo sát</th><th>Trạng thái</th><th>Số người nhận</th><th>Đã hoàn thành</th><th>Tỷ lệ đạt</th></tr></thead>
        <tbody>
          ${surveys.map(s => `<tr><td>${escapeHtml(s.title)}</td><td>${statusLabel(s.status)}</td><td>${s.recipients}</td><td>${s.completed}</td><td>${Number(s.completionRate || 0).toFixed(1)}%</td></tr>`).join("")}
        </tbody>
      </table>

      <div class="signatures">
        <div>
          <strong>NGƯỜI LẬP BÁO CÁO (MANAGER)</strong>
          <span>${escapeHtml(managerName)}</span>
        </div>
        <div>
          <strong>BAN GIÁM ĐỐC PHÊ DUYỆT</strong>
          <span>(Ký, ghi rõ họ tên)</span>
        </div>
      </div>

      <script>
        window.onload = function() { window.print(); }
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

/* ══════════════════════════════════════════════════════════════════════
   ADMIN VIEWS & CUSTOMER VIEWS (GIỮ NGUYÊN VẸN ĐẦY ĐỦ LIÊN KẾT)
   ══════════════════════════════════════════════════════════════════════ */
function adminDashboard() {
  const summary = internalSession.dashboard?.summary || {};
  updateApprovalBadges();
  return `<section class="page-heading compact"><div><p class="eyebrow">QUẢN TRỊ TỐI CAO</p><h1>Trung tâm quản trị Admin</h1><p>Quản lý nhân sự, phán quyết yêu cầu nhạy cảm và giám sát thay đổi dữ liệu khách hàng.</p></div></section>
  <section class="metrics governance-metrics">${metric("Manager nội bộ", internalSession.managers.length, "Nhân sự", "quản lý tại hệ thống", "blue")}${metric("Khách hàng", summary.totalCustomers ?? "—", "Hồ sơ", "đang lưu trong CRM", "green")}${metric("Yêu cầu chờ duyệt", internalSession.customerRequests.filter(item => item.status === "pending").length, "Cần xử lý", "yêu cầu khóa tài khoản", "amber")}</section>
  <section class="governance-grid"><button class="panel governance-card" data-view="accounts"><span>01 · NHÂN SỰ</span><h2>Quản lý Manager</h2><p>Tạo tài khoản, cập nhật thông tin công tác và khóa tài khoản nội bộ.</p><strong>Mở quản lý Manager →</strong></button><button class="panel governance-card" data-view="customer-requests"><span>02 · PHÁN QUYẾT</span><h2>Yêu cầu từ Manager</h2><p>Xem xét lý do và phê duyệt hoặc từ chối yêu cầu khóa tài khoản khách hàng.</p><strong>Xem yêu cầu →</strong></button><button class="panel governance-card" data-view="customers"><span>03 · DỮ LIỆU KHÁCH HÀNG</span><h2>Quản lý Customer</h2><p>Trực tiếp khóa hoặc mở khóa tài khoản khách hàng khi cần thiết.</p><strong>Mở danh sách Customer →</strong></button></section>`;
}

function accountsView() {
  const rows = internalSession.managers;
  return `<section class="page-heading compact"><div><p class="eyebrow">QUẢN TRỊ NHÂN SỰ NỘI BỘ</p><h1>Quản lý Manager</h1><p>Tạo tài khoản nhân viên, cập nhật thông tin công tác và khóa tài khoản khi cần.</p></div></section>
    <form class="panel profile-form manager-create-form" id="createManagerForm"><div class="form-heading"><h2>Thêm tài khoản Manager</h2></div><div class="form-grid"><label>Tên đăng nhập *<input name="tenDangNhap" minlength="3" maxlength="100" pattern="[A-Za-z0-9._-]+" required /></label><label>Mật khẩu ban đầu *<input name="matKhau" type="password" minlength="8" maxlength="128" autocomplete="new-password" required /></label><label>Họ và tên *<input name="hoTen" minlength="2" maxlength="150" required /></label><label>Chức vụ *<input name="chucVu" minlength="2" maxlength="150" required /></label><label>Bộ phận<input name="boPhan" maxlength="150" /></label></div><div class="auth-error" id="createManagerError" role="alert"></div><footer><button class="primary" type="submit">Tạo tài khoản Manager</button></footer></form>
    <section class="panel list-panel"><div class="panel-title"><div><h2>Nhân sự Manager</h2><p>${rows.length} tài khoản</p></div></div><div class="table-wrap"><table><thead><tr><th>Nhân viên</th><th>Chức vụ</th><th>Bộ phận</th><th>Trạng thái</th><th>Ngày tạo</th><th>Thao tác</th></tr></thead><tbody>${rows.map(manager => `<tr><td><div class="customer"><span class="avatar mint">${initials(manager.fullName || manager.username)}</span><div><strong>${escapeHtml(manager.fullName || manager.username)}</strong><small>${escapeHtml(manager.username)}</small></div></div></td><td>${escapeHtml(manager.jobTitle || "Chưa cập nhật")}</td><td>${escapeHtml(manager.department || "—")}</td><td><span class="status ${manager.status === "locked" ? "locked" : "active"}"><i></i>${statusLabel(manager.status)}</span></td><td class="muted">${formatDate(manager.createdAt)}</td><td class="customer-actions"><button class="outline manager-edit" data-id="${manager.id}">Sửa công tác</button><button class="outline manager-status" data-id="${manager.id}" data-status="${manager.status === "locked" ? "active" : "locked"}">${manager.status === "locked" ? "Mở khóa" : "Khóa tài khoản"}</button></td></tr>`).join("") || `<tr><td colspan="6">Chưa có tài khoản Manager.</td></tr>`}</tbody></table></div></section>
    <dialog class="manager-edit-dialog" id="managerEditDialog" aria-labelledby="managerEditTitle"><form class="profile-form" id="managerEditForm"><div class="form-heading"><h2 id="managerEditTitle">Sửa thông tin công tác</h2><p>Cập nhật thông tin nhân viên Manager.</p></div><div class="form-grid"><label>Họ và tên *<input name="hoTen" minlength="2" maxlength="150" required /></label><label>Chức vụ *<input name="chucVu" minlength="2" maxlength="150" required /></label><label>Bộ phận<input name="boPhan" maxlength="150" /></label></div><div class="auth-error" id="managerEditError" role="alert"></div><footer><button class="outline" id="managerEditCancel" type="button">Hủy</button><button class="primary" type="submit">Lưu thay đổi</button></footer></form></dialog>${accountStatusDialog()}`;
}

function customerRequestsView() {
  const requests = internalSession.customerRequests;
  const admin = currentRole === "admin";
  const filters = internalSession.approvalFilters;
  const tabCounts = {
    pending: requests.filter(item => item.status === "pending").length,
    lock_customer: requests.filter(item => item.status === "pending" && item.action === "lock_customer").length,
    unlock_customer: requests.filter(item => item.status === "pending" && item.action === "unlock_customer").length,
    history: requests.filter(item => item.status !== "pending").length
  };
  const tabs = [
    ["pending", "Chờ duyệt"],
    ["lock_customer", "Yêu cầu khóa"],
    ["unlock_customer", "Yêu cầu mở khóa"],
    ["history", "Lịch sử"]
  ];
  updateApprovalBadges();
  return `<section class="page-heading compact"><div><p class="eyebrow">${admin ? "QUẢN TRỊ TỐI CAO" : "YÊU CẦU ĐÃ GỬI"}</p><h1>${admin ? "Trung tâm phê duyệt" : "Yêu cầu đề xuất lên Admin"}</h1><p>${admin ? "Tập trung xử lý các yêu cầu khóa hoặc mở khóa tài khoản; các phán quyết được lưu trong lịch sử." : "Theo dõi trạng thái các yêu cầu đề xuất khóa / mở khóa khách hàng gửi Admin."}</p></div></section>
    <section class="panel approval-center" id="customerRequestCenter">
      <div class="approval-tabs" role="tablist" aria-label="Lọc yêu cầu khách hàng">${tabs.map(([key, label]) => `<button class="approval-tab ${filters.tab === key ? "active" : ""}" id="approval-tab-${key}" type="button" role="tab" aria-selected="${filters.tab === key}" data-tab="${key}">${label}<span>${tabCounts[key]}</span></button>`).join("")}</div>
      <div class="approval-filters"><label class="approval-search">⌕<input id="approvalSearch" type="search" value="${escapeHtml(filters.query)}" placeholder="${admin ? "Tìm khách hàng, Manager, lý do..." : "Tìm khách hàng hoặc lý do..."}" /></label><label>Từ ngày<input id="approvalFrom" type="date" value="${escapeHtml(filters.from)}" /></label><label>Đến ngày<input id="approvalTo" type="date" value="${escapeHtml(filters.to)}" /></label></div>
      <div id="requestResults">${customerRequestResults(requests, filters, admin)}</div>
    </section>`;
}

function customerRequestResults(requests, filters, admin) {
  const matchesTab = item => {
    if (filters.tab === "pending") return item.status === "pending";
    if (filters.tab === "history") return item.status !== "pending";
    return item.status === "pending" && item.action === filters.tab;
  };
  const query = filters.query.trim().toLocaleLowerCase("vi");
  const fromDate = filters.from ? new Date(`${filters.from}T00:00:00`) : null;
  const toDate = filters.to ? new Date(`${filters.to}T23:59:59.999`) : null;
  const filtered = requests.filter(item => {
    if (!matchesTab(item)) return false;
    const searchable = `${item.customerName || ""} ${item.requesterName || ""} ${item.requesterUsername || ""} ${item.reason || ""} ${item.id}`.toLocaleLowerCase("vi");
    if (query && !searchable.includes(query)) return false;
    const createdAt = new Date(item.createdAt);
    if (fromDate && createdAt < fromDate) return false;
    if (toDate && createdAt > toDate) return false;
    return true;
  });
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  filters.page = Math.min(Math.max(1, filters.page), pageCount);
  const visible = filtered.slice((filters.page - 1) * pageSize, filters.page * pageSize);
  const emptyMessage = filters.tab === "history" ? "Chưa có yêu cầu nào trong lịch sử" : admin ? "Không có yêu cầu phù hợp đang chờ xử lý" : "Bạn chưa gửi yêu cầu nào";
  const cards = visible.map(item => {
    const isUnlock = item.action === "unlock_customer";
    const tagBadge = isUnlock
      ? `<span class="request-tag" style="color:var(--green);background:#e5f3ed;padding:3px 8px;border-radius:6px;font-weight:700">🔓 Yêu cầu mở khóa</span>`
      : `<span class="request-tag" style="color:#c04a36;background:#fdece8;padding:3px 8px;border-radius:6px;font-weight:700">⚑ Yêu cầu khóa</span>`;
    const approveLabel = isUnlock ? "Phê duyệt & mở khóa" : "Phê duyệt & khóa";
    const approveColor = isUnlock ? "background:var(--green);border-color:var(--green)" : "";

    return `<article class="panel request-card"><div class="request-heading"><div><span class="status ${item.status === "pending" ? "new" : item.status === "approved" ? "active" : "locked"}">${item.status === "pending" ? "Chờ duyệt" : item.status === "approved" ? "Đã duyệt" : "Đã từ chối"}</span><h2>${escapeHtml(item.customerName || "Khách hàng không còn tồn tại")}</h2><p>Manager: ${escapeHtml(item.requesterName || item.requesterUsername || "Bạn")} · ${formatDate(item.createdAt)}</p></div>${tagBadge}</div><p class="request-reason"><strong>Lý do:</strong> ${escapeHtml(item.reason)}</p>${item.decisionNote ? `<p class="form-note"><strong>Ghi chú Admin:</strong> ${escapeHtml(item.decisionNote)}</p>` : ""}${admin && item.status === "pending" ? `<footer><button class="outline request-reject" data-id="${item.id}" data-action="${item.action}">Từ chối</button><button class="primary request-approve" data-id="${item.id}" data-action="${item.action}" style="${approveColor}">${approveLabel}</button></footer>` : ""}</article>`;
  }).join("");
  const start = filtered.length ? (filters.page - 1) * pageSize + 1 : 0;
  const end = Math.min(filters.page * pageSize, filtered.length);
  return `<div class="request-list">${cards || `<article class="panel empty-state"><h2>${emptyMessage}</h2></article>`}</div><footer class="approval-pagination"><span>Hiển thị ${start}–${end} trên ${filtered.length} yêu cầu</span><div><button class="outline approval-page" type="button" data-page="${filters.page - 1}" ${filters.page <= 1 ? "disabled" : ""}>← Trước</button><span>Trang ${filters.page}/${pageCount}</span><button class="outline approval-page" type="button" data-page="${filters.page + 1}" ${filters.page >= pageCount ? "disabled" : ""}>Sau →</button></div></footer>`;
}

function updateApprovalBadges() {
  const pending = internalSession.customerRequests.filter(item => item.status === "pending").length;
  const bellBadge = document.querySelector("#approvalCount");
  if (bellBadge) {
    bellBadge.textContent = pending;
    bellBadge.hidden = pending === 0;
    bellBadge.closest(".notification")?.classList.toggle("has-pending", pending > 0);
  }
  const navBadge = document.querySelector("#approvalNavCount");
  if (navBadge) {
    navBadge.textContent = pending;
    navBadge.hidden = pending === 0;
  }
}

function internalLoginView() {
  const portalName = internalApi.portal === "admin" ? "Admin" : "Manager";
  const demoAccount = internalApi.portal === "admin" ? "admin" : "quanly";
  return `<section class="auth-shell"><div class="auth-story"><span class="welcome-chip">CỔNG ${portalName.toUpperCase()} CRM</span><h1>Quản lý dữ liệu<br/>toàn chuỗi.</h1><p>Đăng nhập bằng tài khoản ${portalName} để truy cập dữ liệu thật.</p></div><form class="auth-card" id="internalLoginForm"><div class="form-heading"><p class="eyebrow">KHU VỰC ${portalName.toUpperCase()}</p><h2>Đăng nhập</h2><p>Phiên làm việc được phân quyền tại API.</p></div><label>Tên đăng nhập<input name="tenDangNhap" autocomplete="username" required /></label><label>Mật khẩu<input name="matKhau" type="password" autocomplete="current-password" required /></label><div class="auth-error" id="internalAuthError" role="alert"></div><button class="primary auth-submit" type="submit">Đăng nhập →</button><small>Demo: ${demoAccount} / DemoCRM@2026</small></form></section>`;
}

function adminCatalogView() {
  const catalogs = internalSession.catalogs || { preferences: [], drinks: [] };
  return `<section class="page-heading compact"><div><p class="eyebrow">DANH MỤC HỆ THỐNG</p><h1>Danh mục đồ uống</h1><p>Quản lý các món khách hàng có thể chọn để đánh giá.</p></div><button class="primary" id="openDrinkDialog">＋ Thêm đồ uống</button></section><section class="catalog-layout"><article class="panel"><div class="panel-title"><div><h2>Nhóm sở thích</h2><p>${catalogs.preferences.length} nhóm</p></div></div>${catalogs.preferences.map((x,i)=>`<div class="catalog-row"><span class="catalog-icon">${i+1}</span><div><strong>${escapeHtml(x.name)}</strong><small>${escapeHtml(x.description || "Không có mô tả")}</small></div><span class="status ${x.active ? "active" : "locked"}">${x.active ? "Đang dùng" : "Ngừng dùng"}</span></div>`).join("")}</article><article class="panel"><div class="panel-title"><div><h2>Đồ uống</h2><p>${catalogs.drinks.length} sản phẩm</p></div></div>${catalogs.drinks.map(x=>`<div class="catalog-row"><span class="drink-dot green">☕</span><div><strong>${escapeHtml(x.name)}</strong><small>${escapeHtml(x.code)} · ${escapeHtml(x.description || "Chưa có mô tả")}</small></div><div class="drink-actions"><span class="status ${x.active ? "active" : "locked"}">${x.active ? "Kinh doanh" : "Ngừng bán"}</span><button class="outline drink-status" data-id="${x.id}" data-active="${x.active ? "false" : "true"}">${x.active ? "Ngừng bán" : "Mở bán lại"}</button></div></div>`).join("")}</article></section><dialog class="manager-edit-dialog" id="drinkDialog"><form class="profile-form" id="drinkForm"><div class="form-heading"><p class="eyebrow">SẢN PHẨM MỚI</p><h2>Thêm đồ uống</h2><p>Món đang kinh doanh sẽ xuất hiện ngay trên trang đánh giá của Customer.</p></div><div class="form-grid"><label>Mã đồ uống *<input name="maDoUong" minlength="2" maxlength="30" placeholder="VD: TS03" required /></label><label>Tên đồ uống *<input name="tenDoUong" minlength="2" maxlength="150" placeholder="VD: Trà sữa matcha" required /></label></div><label>Mô tả<textarea name="moTa" rows="4" maxlength="1000" placeholder="Thành phần hoặc đặc điểm nổi bật"></textarea></label><div class="auth-error" id="drinkError" role="alert"></div><footer><button class="outline" id="cancelDrink" type="button">Hủy</button><button class="primary" type="submit">Thêm đồ uống</button></footer></form></dialog>`;
}

function loginView() {
  return `<section class="auth-shell"><div class="auth-story"><span class="welcome-chip">MILKTEA-COFFEE CRM</span><h1>Chào mừng bạn<br/>quay trở lại.</h1><p>Đăng nhập để cập nhật sở thích, gửi phản hồi và thực hiện khảo sát dành riêng cho bạn.</p><div class="auth-quote"><span>☕</span><p>“Mỗi góp ý của bạn giúp một ly nước ngày mai ngon hơn.”</p></div></div><form class="auth-card" id="loginForm"><div class="form-heading"><p class="eyebrow">KHU VỰC KHÁCH HÀNG</p><h2>Đăng nhập</h2><p>Sử dụng tài khoản thành viên của bạn.</p></div><label>Tên đăng nhập<input name="tenDangNhap" autocomplete="username" placeholder="Ví dụ: khach01" required /></label><label>Mật khẩu<input name="matKhau" type="password" autocomplete="current-password" placeholder="Nhập mật khẩu" required /></label><div class="auth-error" id="authError" role="alert"></div><button class="primary auth-submit" type="submit">Đăng nhập →</button><p class="auth-switch">Chưa có tài khoản? <button type="button" data-view="register">Đăng ký thành viên</button></p><small>Tài khoản demo: khach01 / DemoCRM@2026</small></form></section>`;
}

function registerView() {
  return `<section class="auth-shell"><div class="auth-story register-story"><span class="welcome-chip">THÀNH VIÊN MỚI</span><h1>Gia nhập cộng đồng<br/>milktea-coffee.</h1><p>Chia sẻ khẩu vị để chúng tôi hiểu bạn hơn trong mỗi lần ghé.</p><div class="auth-quote"><span>✦</span><p>Tài khoản giúp theo dõi trải nghiệm của bạn trên toàn hệ thống.</p></div></div><form class="auth-card register-card" id="registerForm"><div class="form-heading"><p class="eyebrow">TẠO TÀI KHOẢN</p><h2>Đăng ký thành viên</h2><p>Điền đầy đủ thông tin bắt buộc bên dưới.</p></div><div class="form-grid"><label>Tên đăng nhập *<input name="tenDangNhap" minlength="3" maxlength="100" pattern="[A-Za-z0-9._-]+" autocomplete="username" required /></label><label>Họ và tên *<input name="hoTen" minlength="2" maxlength="150" autocomplete="name" required /></label><label>Mật khẩu *<input name="matKhau" type="password" minlength="8" maxlength="128" autocomplete="new-password" required /><small>Từ 8 đến 128 ký tự</small></label><label>Xác nhận mật khẩu *<input name="matKhauXacNhan" type="password" minlength="8" maxlength="128" autocomplete="new-password" required /></label><label>Năm sinh *<input name="namSinh" type="number" min="1900" max="${new Date().getFullYear()}" required /></label><label>Giới tính<select name="gioiTinh"><option value="khong_cung_cap">Không cung cấp</option><option value="nam">Nam</option><option value="nu">Nữ</option><option value="khac">Khác</option></select></label><label>Sở thích mặc định *<select name="soThichId" id="registerPreference" required><option value="">Đang tải...</option></select></label></div><div class="auth-error" id="authError" role="alert"></div><button class="primary auth-submit" type="submit">Tạo tài khoản →</button><p class="auth-switch">Đã có tài khoản? <button type="button" data-view="login">Đăng nhập</button></p></form></section>`;
}

function customerHome() {
  return `<section class="customer-hero"><div><span class="welcome-chip">THÀNH VIÊN MILKTEA-COFFEE</span><h1 id="customerGreeting">Xin chào!</h1><p>Một ngày thật dịu dàng cùng ly trà bạn yêu thích.</p><div class="member-code"><span>Mã thành viên</span><strong id="customerMemberCode">—</strong></div></div><div class="hero-cup" aria-hidden="true"><span>MC</span></div></section>
  <section class="customer-stats"><article><span class="soft-icon">✓</span><div><small>Khảo sát đã hoàn thành</small><strong id="custStatCompleted">0</strong><p>Đóng góp ý kiến cho quán</p></div></article><article><span class="soft-icon amber">☆</span><div><small>Đánh giá trung bình</small><strong id="custStatAvg">4.8</strong><p>Cảm ơn những chia sẻ của bạn</p></div></article><article><span class="soft-icon rose">◌</span><div><small>Phản hồi đã gửi</small><strong id="custStatFeedback">0</strong><p>100% đã được tiếp nhận</p></div></article></section>
  <section class="customer-layout"><div><div class="section-title"><div><p class="eyebrow">DÀNH CHO BẠN</p><h2>Khảo sát đang chờ</h2></div><button class="text-button" data-view="my-surveys">Xem tất cả →</button></div><article class="task-card"><div class="task-art">☕</div><div class="task-copy"><span class="status active">Đang mở</span><h3>Khảo sát sản phẩm mới</h3><p>Chia sẻ trải nghiệm gần nhất của bạn tại milktea-coffee.</p><div class="task-meta"><span>◷ Khoảng 3 phút</span><span>▣ Đang mở</span></div></div><button class="primary" id="startSurvey">Bắt đầu →</button></article></div><aside class="panel quick-actions"><div class="panel-title"><div><h2>Truy cập nhanh</h2><p>Chúng tôi luôn muốn lắng nghe bạn</p></div></div><button data-view="my-feedback"><span>♡</span><div><strong>Gửi phản hồi</strong><small>Chia sẻ trải nghiệm đồ uống</small></div><b>→</b></button><button data-view="profile"><span>♧</span><div><strong>Cập nhật hồ sơ</strong><small>Sở thích và thông tin cá nhân</small></div><b>→</b></button></aside></section>`;
}

function profileView() {
  return `<section class="page-heading compact"><div><p class="eyebrow">TÀI KHOẢN CỦA TÔI</p><h1>Hồ sơ cá nhân</h1><p>Thông tin này giúp chúng tôi mang đến trải nghiệm phù hợp hơn.</p></div></section><section class="profile-layout"><aside class="panel profile-summary"><div class="large-avatar">?</div><h2></h2><p></p><span class="status active"><i></i>Đang hoạt động</span><dl><div><dt>Mã thành viên</dt><dd></dd></div><div><dt>Tham gia từ</dt><dd></dd></div></dl></aside><div class="profile-settings"><form class="panel profile-form" id="profileForm"><div class="form-heading"><h2>Thông tin cơ bản</h2><p>Các trường có dấu * là bắt buộc.</p></div><div class="form-grid"><label>Họ và tên *<input name="hoTen" required /></label><label>Năm sinh *<input name="namSinh" type="number" min="1900" max="${new Date().getFullYear()}" required /></label><label>Giới tính<select name="gioiTinh"><option value="nam">Nam</option><option value="nu">Nữ</option><option value="khac">Khác</option><option value="khong_cung_cap">Không cung cấp</option></select></label><label>Sở thích mặc định *<select name="soThichId" id="profilePreference" required></select></label></div><div class="form-note">✦ Sở thích được dùng để cá nhân hóa khảo sát và gợi ý sản phẩm.</div><footer><button type="button" class="outline" id="profileCancel">Hủy thay đổi</button><button class="primary" type="submit">Lưu hồ sơ</button></footer></form><form class="panel profile-form security-form" id="passwordForm"><div class="form-heading"><h2>Bảo mật tài khoản</h2><p>Đổi mật khẩu định kỳ để bảo vệ tài khoản của bạn.</p></div><div class="form-grid"><label>Mật khẩu hiện tại *<input name="matKhauHienTai" type="password" minlength="8" maxlength="128" autocomplete="current-password" required /></label><label>Mật khẩu mới *<input name="matKhauMoi" type="password" minlength="8" maxlength="128" autocomplete="new-password" required /></label><label class="full-width">Xác nhận mật khẩu mới *<input name="matKhauMoiXacNhan" type="password" minlength="8" maxlength="128" autocomplete="new-password" required /></label></div><div class="auth-error" id="passwordError" role="alert" aria-live="polite"></div><footer><button class="primary" type="submit">Đổi mật khẩu</button></footer></form></div></section>`;
}

function myFeedbackView() {
  return `<section class="page-heading compact"><div><p class="eyebrow">CHIA SẺ CÙNG CHÚNG TÔI</p><h1>Phản hồi của tôi</h1><p>Mỗi góp ý của bạn đều giúp milktea-coffee tốt hơn mỗi ngày.</p></div></section><section class="customer-layout feedback-layout"><form class="panel feedback-form" id="feedbackForm"><div class="form-heading"><h2>Gửi phản hồi mới</h2><p>Hãy kể cho chúng tôi về trải nghiệm gần nhất.</p></div><label>Đồ uống *<select name="doUongId" id="feedbackDrink" required><option value="">Đang tải...</option></select></label><fieldset><legend>Mức độ hài lòng *</legend><input type="hidden" name="soSao" id="feedbackRating" /><div class="star-picker" role="group" aria-label="Chọn mức độ hài lòng"><button type="button" data-rating="1" aria-label="1 sao">★</button><button type="button" data-rating="2" aria-label="2 sao">★</button><button type="button" data-rating="3" aria-label="3 sao">★</button><button type="button" data-rating="4" aria-label="4 sao">★</button><button type="button" data-rating="5" aria-label="5 sao">★</button></div></fieldset><label>Nội dung phản hồi *<textarea name="noiDung" rows="5" minlength="10" maxlength="5000" placeholder="Điều gì khiến bạn hài lòng hoặc chưa hài lòng?" required></textarea><small>Tối thiểu 10 ký tự</small></label><div class="auth-error" id="feedbackError" role="alert" aria-live="polite"></div><button class="primary" type="submit">Gửi phản hồi</button></form><div><div class="section-title"><div><p class="eyebrow">LỊCH SỬ</p><h2>Phản hồi gần đây</h2></div><span class="feedback-total" id="feedbackTotal">—</span></div><div class="segmented feedback-filters" id="feedbackFilters" aria-label="Lọc phản hồi"><button data-feedback-filter="all">Tất cả <b id="allFeedbackCount">—</b></button><button data-feedback-filter="new">Chờ xử lý <b id="newFeedbackCount">—</b></button><button data-feedback-filter="handled">Đã xử lý <b id="handledFeedbackCount">—</b></button></div><div id="feedbackHistory" aria-live="polite"><article class="history-card"><p>Đang tải lịch sử phản hồi...</p></article></div><button class="outline feedback-load-more" id="feedbackLoadMore" type="button" hidden>Xem thêm phản hồi</button></div></section>`;
}

function mySurveysView() {
  return `<section class="page-heading compact"><div><p class="eyebrow">Ý KIẾN CỦA BẠN</p><h1>Khảo sát của tôi</h1><p>Các khảo sát được gửi riêng đến tài khoản của bạn.</p></div></section><div id="surveyList" class="survey-list"><article class="panel empty-state"><h2>Đang tải khảo sát...</h2></article></div>`;
}

function surveyTakeView() {
  const survey = customerSession.currentSurvey;
  if (!survey) return `<section class="panel empty-state"><h2>Không có khảo sát đang mở</h2><button class="outline" data-view="my-surveys">Quay lại danh sách</button></section>`;
  const index = customerSession.questionIndex;
  const question = survey.questions[index];
  const progress = Math.round(((index + 1) / survey.questions.length) * 100);
  const selectedAnswer = customerSession.answers.find(item => item.cauHoiId === question.id);
  return `<section class="survey-shell"><header><button class="back-link" data-view="my-surveys">← Lưu và thoát</button><span>Câu ${index + 1} / ${survey.questions.length}</span></header><div class="progress"><i style="width:${progress}%"></i></div><article class="survey-question"><p class="eyebrow">${escapeHtml(survey.title)}</p><h1>${escapeHtml(question.content)}</h1><p>Chọn một phương án phù hợp nhất với trải nghiệm của bạn.</p><div class="answer-list">${question.choices.map(choice => `<label><input type="radio" name="answer" value="${choice.id}" ${selectedAnswer?.luaChonId === choice.id ? "checked" : ""}/><span>☕</span><strong>${escapeHtml(choice.content)}</strong><i>○</i></label>`).join("")}</div><footer><div>${index ? `<button class="outline" id="previousQuestion">← Câu trước</button>` : `<small>${question.batBuoc ? "Câu hỏi bắt buộc" : "Câu hỏi không bắt buộc"}</small>`}</div><button class="primary" id="nextQuestion">${index + 1 === survey.questions.length ? "Hoàn tất khảo sát" : "Tiếp tục →"}</button></footer></article></section><dialog class="survey-submit-dialog" id="surveySubmitDialog" aria-labelledby="surveySubmitTitle"><div><span class="survey-confirm-icon">✓</span><h2 id="surveySubmitTitle">Xác nhận gửi khảo sát?</h2><p>Sau khi gửi, câu trả lời sẽ được ghi nhận và không thể chỉnh sửa.</p><footer><button class="outline" id="surveySubmitCancel" type="button">Kiểm tra lại</button><button class="primary" id="surveySubmitConfirm" type="button">Xác nhận gửi</button></footer></div></dialog>`;
}

function completedSurveyView() {
  const survey = customerSession.completedSurvey;
  if (!survey) return `<section class="panel empty-state"><h2>Không tìm thấy kết quả khảo sát</h2><button class="outline" data-view="my-surveys">Quay lại danh sách</button></section>`;
  return `<section class="page-heading compact"><div><p class="eyebrow">KHẢO SÁT ĐÃ HOÀN THÀNH</p><h1>${escapeHtml(survey.title)}</h1><p>Đã nộp ${new Date(survey.completedAt).toLocaleString("vi-VN")} · Câu trả lời chỉ có thể xem.</p></div><button class="outline" data-view="my-surveys">← Danh sách khảo sát</button></section><section class="completed-survey-list">${survey.questions.map((question, index) => `<article class="panel completed-answer"><span>${String(index + 1).padStart(2, "0")}</span><div><small>CÂU HỎI</small><h2>${escapeHtml(question.content)}</h2><small>CÂU TRẢ LỜI CỦA BẠN</small><p class="${question.choiceContent ? "" : "muted"}">${question.choiceContent ? `✓ ${escapeHtml(question.choiceContent)}` : "Không trả lời"}</p></div></article>`).join("")}</section>`;
}

function customerHelpView() {
  return `<section class="page-heading compact"><div><p class="eyebrow">HỖ TRỢ KHÁCH HÀNG</p><h1>Chúng tôi có thể giúp gì?</h1><p>Tìm nhanh hướng dẫn sử dụng tài khoản, khảo sát và phản hồi.</p></div></section><section class="help-search-panel"><label><span>⌕</span><input id="helpSearch" value="${escapeHtml(customerSession.helpQuery)}" placeholder="Nhập nội dung cần trợ giúp..." autocomplete="off" /></label><small>Ví dụ: đổi mật khẩu, lưu khảo sát, xem phản hồi</small></section><div class="help-layout"><section><div class="section-title"><div><p class="eyebrow">CÂU HỎI THƯỜNG GẶP</p><h2 id="helpResultTitle">Tất cả hướng dẫn</h2></div><span class="feedback-total" id="helpResultCount">${customerHelpTopics.length} mục</span></div><div class="help-topics" id="helpTopics"></div></section><aside class="panel help-contact"><span>♡</span><h2>Vẫn cần hỗ trợ?</h2><p>Gửi phản hồi và mô tả vấn đề bạn đang gặp. Đội ngũ chăm sóc sẽ tiếp nhận trên hệ thống.</p><button class="primary" data-view="my-feedback">Gửi yêu cầu hỗ trợ</button></aside></div>`;
}

function notificationsView() {
  return `<section class="page-heading compact"><div><p class="eyebrow">THÔNG BÁO</p><h1>Thông báo của tôi</h1><p>Khảo sát mới và trả lời từ đội ngũ chăm sóc khách hàng.</p></div></section><section class="survey-list">${customerSession.notifications.length ? customerSession.notifications.map(item => `<article class="panel my-survey ${item.read ? "" : "featured"}"><div class="survey-number ${item.read ? "done" : ""}">${item.type === "survey" ? "✓" : "♡"}</div><div><span class="status ${item.read ? "locked" : "active"}">${item.read ? "Đã đọc" : "Mới"}</span><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.content)} · ${formatDate(item.createdAt)}</p></div>${item.link ? `<button class="outline notification-open" data-id="${item.id}" data-link="${escapeHtml(item.link)}">Xem →</button>` : ""}</article>`).join("") : `<article class="panel empty-state"><span>♢</span><h2>Chưa có thông báo</h2></article>`}</section>`;
}

/* ══════════════════════════════════════════════════════════════════════
   ROUTER & NAVIGATION MAPPING
   ══════════════════════════════════════════════════════════════════════ */
const managerViews = {
  "internal-login": internalLoginView,
  dashboard,
  customers: customersView,
  "create-customer": createCustomerView,
  "customer-requests": customerRequestsView,
  feedback: feedbackView,
  surveys: surveysView,
  "create-survey": createSurveyView,
  "edit-survey": editSurveyView,
  reports: customerReportsView,
  "survey-results": surveyResultsView,
  catalog: adminCatalogView
};

const adminViews = {
  "internal-login": internalLoginView,
  "admin-dashboard": adminDashboard,
  accounts: accountsView,
  customers: customersView,
  "customer-requests": customerRequestsView,
  "admin-catalog": adminCatalogView
};

const customerViews = {
  login: loginView,
  register: registerView,
  "customer-home": customerHome,
  profile: profileView,
  "my-feedback": myFeedbackView,
  "my-surveys": mySurveysView,
  notifications: notificationsView,
  "take-survey": surveyTakeView
};

const titles = {
  "internal-login": "Đăng nhập nội bộ",
  "admin-dashboard": "Quản trị tối cao",
  accounts: "Quản lý Manager",
  "customer-requests": "Yêu cầu Admin",
  "admin-catalog": "Danh mục hệ thống",
  catalog: "Danh mục",
  dashboard: "Tổng quan Manager",
  customers: "Chăm sóc khách hàng",
  "create-customer": "Thêm khách hàng mới",
  feedback: "Quản lý phản hồi",
  surveys: "Khảo sát sản phẩm mới",
  "create-survey": "Tạo khảo sát",
  "edit-survey": "Sửa khảo sát",
  "survey-results": "Kết quả khảo sát",
  reports: "Báo cáo nhân khẩu học & khảo sát",
  settings: "Cài đặt",
  login: "Đăng nhập",
  register: "Đăng ký",
  "customer-home": "Trang chủ",
  profile: "Hồ sơ cá nhân",
  "my-feedback": "Phản hồi của tôi",
  "my-surveys": "Khảo sát của tôi",
  notifications: "Thông báo",
  "take-survey": "Thực hiện khảo sát"
};

const managerViews = { "internal-login": internalLoginView, dashboard, customers: customersView, "create-customer": createCustomerView, "customer-requests": customerRequestsView, feedback: feedbackView, surveys: surveysView, "create-survey": createSurveyView, "edit-survey": editSurveyView, reports: customerReportsView, "survey-results": surveyResultsView, "admin-catalog": adminCatalogView };
const adminViews = { "internal-login": internalLoginView, "admin-dashboard": adminDashboard, accounts: accountsView, customers: customersView, "customer-requests": customerRequestsView };
const customerViews = { login: loginView, register: registerView, "customer-home": customerHome, profile: profileView, "my-feedback": myFeedbackView, "my-surveys": mySurveysView, notifications: notificationsView, "take-survey": surveyTakeView, "completed-survey": completedSurveyView, help: customerHelpView };
const titles = { "internal-login": "Đăng nhập nội bộ", "admin-dashboard": "Quản trị tối cao", accounts: "Quản lý Manager", "customer-requests": "Yêu cầu Admin", "admin-catalog": "Danh mục", dashboard: "Tổng quan", customers: "Khách hàng", "create-customer": "Thêm khách hàng", feedback: "Phản hồi", surveys: "Khảo sát", "create-survey": "Tạo khảo sát", "edit-survey": "Sửa khảo sát", "survey-results": "Kết quả khảo sát", reports: "Báo cáo khách hàng", settings: "Cài đặt", login: "Đăng nhập", register: "Đăng ký", "customer-home": "Trang chủ", profile: "Hồ sơ", "my-feedback": "Phản hồi của tôi", "my-surveys": "Khảo sát của tôi", notifications: "Thông báo", "take-survey": "Thực hiện khảo sát", "completed-survey": "Kết quả khảo sát", help: "Trung tâm trợ giúp" };
const navs = {
  admin: `<p class="nav-label">Quản trị tối cao</p><button class="nav-item" data-view="admin-dashboard"><span class="icon">⌂</span>Tổng quan</button><button class="nav-item" data-view="accounts"><span class="icon">♧</span>Quản lý Manager</button><button class="nav-item" data-view="customer-requests"><span class="icon">◌</span>Trung tâm phê duyệt <b id="approvalNavCount" hidden></b></button><button class="nav-item" data-view="customers"><span class="icon">♧</span>Khách hàng</button>`,
  manager: `<p class="nav-label">Không gian làm việc</p><button class="nav-item" data-view="dashboard"><span class="icon">⌂</span>Tổng quan</button><button class="nav-item" data-view="customers"><span class="icon">♧</span>Khách hàng <b id="customerCount">…</b></button><button class="nav-item" data-view="customer-requests"><span class="icon">◌</span>Yêu cầu Admin</button><button class="nav-item" data-view="feedback"><span class="icon">◌</span>Phản hồi <i id="feedbackCount">…</i></button><button class="nav-item" data-view="surveys"><span class="icon">✓</span>Khảo sát</button><button class="nav-item" data-view="admin-catalog"><span class="icon">☕</span>Đồ uống</button><button class="nav-item" data-view="reports"><span class="icon">⌁</span>Báo cáo</button>`,
  customer: `<p class="nav-label">Tài khoản của tôi</p><button class="nav-item" data-view="customer-home"><span class="icon">⌂</span>Trang chủ</button><button class="nav-item" data-view="profile"><span class="icon">♧</span>Hồ sơ cá nhân</button><button class="nav-item" data-view="my-feedback"><span class="icon">♡</span>Phản hồi của tôi</button><button class="nav-item" data-view="my-surveys"><span class="icon">✓</span>Khảo sát</button><button class="nav-item" data-view="notifications"><span class="icon">♢</span>Thông báo <i id="notificationCount">0</i></button><p class="nav-label">Hỗ trợ</p><button class="nav-item" data-view="help"><span class="icon">?</span>Trung tâm trợ giúp</button>`
};

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
let currentRole = "manager";
let navigationVersion = 0;
let feedbackSubmitting = false;

function notify(message = "Thao tác thành công") {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2800);
}
function formPayload(form) { return Object.fromEntries(new FormData(form).entries()); }
function setFormBusy(form, busy) {
  const button = form.querySelector("button[type='submit']");
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? "Đang xử lý..." : button.dataset.label || button.textContent;
}

/* ══════════════════════════════════════════════════════════════════════
   CUSTOMER PAGE SETUP
   ══════════════════════════════════════════════════════════════════════ */
async function setupCustomerPage(view) {
  if (currentRole !== "customer") return;
  const errorBox = document.querySelector("#authError");
  const showError = error => { if (errorBox) errorBox.textContent = error.message; else notify(error.message); };

  if (view === "register") {
    try {
      customerSession.options ||= await customerApi.options();
      const select = document.querySelector("#registerPreference");
      if (select) {
        select.innerHTML = `<option value="">Chọn sở thích</option>${customerSession.options.preferences.map(item => `<option value="${item.id}">${escapeHtml(item.tenNhom)}</option>`).join("")}`;
      }
    } catch (error) { showError(error); }
  }

  document.querySelector("#loginForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    setFormBusy(form, true);
    try {
      const data = await customerApi.login(formPayload(form));
      customerSession.profile = data.profile;
      notify("Đăng nhập thành công");
      applyRole("customer");
    } catch (error) { showError(error); setFormBusy(form, false); }
  });

  document.querySelector("#registerForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    setFormBusy(form, true);
    try {
      const payload = formPayload(form);
      if (payload.matKhau !== payload.matKhauXacNhan) throw new Error("Mật khẩu xác nhận chưa khớp");
      payload.namSinh = Number(payload.namSinh); payload.soThichId = Number(payload.soThichId);
      const data = await customerApi.register(payload); customerSession.profile = data.profile;
      notify("Đăng ký thành công"); applyRole("customer");
      payload.namSinh = Number(payload.namSinh);
      payload.soThichId = Number(payload.soThichId);
      const data = await customerApi.register(payload);
      customerSession.profile = data.profile;
      notify("Đăng ký thành viên thành công");
      applyRole("customer");
    } catch (error) { showError(error); setFormBusy(form, false); }
  });

  if (!customerApi.hasToken() || ["login", "register"].includes(view)) return;

  try {
    const profileWasMissing = !customerSession.profile;
    if (profileWasMissing) customerSession.profile = (await customerApi.me()).profile;
    const profile = customerSession.profile;

    document.querySelector("#userInitials").textContent = initials(profile.hoTen);
    document.querySelector("#userName").textContent = profile.hoTen;
    document.querySelector("#userRole").textContent = `Khách hàng · ${profile.maThanhVien}`;

    if (profileWasMissing && ["profile", "customer-home"].includes(view)) { render(view); return; }

    if (view === "customer-home") {
      document.querySelector("#customerGreeting").textContent = `Xin chào, ${profile.hoTen}!`;
      document.querySelector("#customerMemberCode").textContent = profile.maThanhVien;
      const [surveyData, feedbackData] = await Promise.all([customerApi.surveys(), customerApi.feedback()]);
      const completedSurveys = surveyData.surveys.filter(survey => survey.ngayHoanThanh).length;
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();
      const completedThisMonth = surveyData.surveys.filter(survey => {
        if (!survey.ngayHoanThanh) return false;
        const completedAt = new Date(survey.ngayHoanThanh);
        return completedAt.getMonth() === currentMonth && completedAt.getFullYear() === currentYear;
      }).length;
      const availableSurveys = surveyData.surveys.filter(survey =>
        !survey.ngayHoanThanh && survey.trangThai === "dang_mo" &&
        (!survey.ngayKetThuc || new Date(survey.ngayKetThuc) > new Date())
      );
      const handledFeedback = feedbackData.feedback.filter(item => item.trangThai !== "moi").length;
      document.querySelector("#completedSurveyCount").textContent = completedSurveys;
      document.querySelector("#completedSurveyNote").textContent = completedThisMonth
        ? `${completedThisMonth} khảo sát trong tháng này`
        : "Chưa hoàn thành khảo sát trong tháng này";
      document.querySelector("#averageRating").textContent = feedbackData.feedback.length
        ? (feedbackData.feedback.reduce((sum, item) => sum + Number(item.soSao), 0) / feedbackData.feedback.length).toFixed(1)
        : "—";
      document.querySelector("#averageRatingNote").textContent = feedbackData.feedback.length
        ? `Tính từ ${feedbackData.feedback.length} phản hồi đã gửi`
        : "Chưa có đánh giá nào";
      document.querySelector("#feedbackCountCustomer").textContent = feedbackData.feedback.length;
      document.querySelector("#feedbackStatusNote").textContent = feedbackData.feedback.length
        ? `${handledFeedback}/${feedbackData.feedback.length} phản hồi đã được xử lý`
        : "Hãy gửi phản hồi đầu tiên của bạn";
      const sidebarCard = document.querySelector("#sidebarCard");
      sidebarCard.innerHTML = availableSurveys.length
        ? `<span>✦</span><strong>${availableSurveys.length} khảo sát đang chờ</strong><p>Ý kiến của bạn giúp chúng tôi phục vụ tốt hơn.</p><button data-view="my-surveys">Thực hiện ngay →</button>`
        : `<span>✓</span><strong>Đã hoàn tất</strong><p>Hiện không có khảo sát nào đang chờ bạn.</p><button data-view="my-surveys">Xem lịch sử →</button>`;
      const taskCard = document.querySelector(".task-card");
      if (availableSurveys.length) {
        const survey = availableSurveys[0];
        taskCard.querySelector(".status").textContent = "Đang mở";
        taskCard.querySelector("h3").textContent = survey.tieuDe;
        taskCard.querySelector("p").textContent = `${survey.soCauHoi} câu hỏi đang chờ ý kiến của bạn.`;
        taskCard.querySelector(".task-meta span:first-child").textContent = `◷ Khoảng ${Math.max(1, Math.ceil(survey.soCauHoi / 2))} phút`;
        taskCard.querySelector(".task-meta span:last-child").textContent = survey.ngayKetThuc
          ? `▣ Hạn ${new Date(survey.ngayKetThuc).toLocaleDateString("vi-VN")}`
          : "▣ Không giới hạn thời gian";
        taskCard.insertAdjacentHTML("beforeend", `<button class="primary" id="startSurvey">Bắt đầu →</button>`);
        taskCard.querySelector("#startSurvey").addEventListener("click", async () => {
          try {
            customerSession.currentSurvey = (await customerApi.survey(survey.id)).survey;
            customerSession.questionIndex = 0;
            customerSession.answers = validSurveyDraft(customerSession.currentSurvey);
            render("take-survey");
          } catch (error) { notify(error.message); }
        });
      } else {
        taskCard.innerHTML = `<div class="task-copy"><span class="status locked">Chưa có khảo sát</span><h3>Hiện không có khảo sát đang chờ</h3><p>Khi có khảo sát mới, thông báo sẽ hiển thị tại đây.</p></div>`;
      }
    }

    if (["profile", "my-feedback"].includes(view)) customerSession.options ||= await customerApi.options();

    if (view === "profile") {
      const select = document.querySelector("#profilePreference");
      if (select) {
        select.innerHTML = customerSession.options.preferences.map(item => `<option value="${item.id}" ${Number(profile.soThichId) === Number(item.id) ? "selected" : ""}>${escapeHtml(item.tenNhom)}</option>`).join("");
      }
      const form = document.querySelector("#profileForm");
      form.elements.hoTen.value = profile.hoTen;
      form.elements.namSinh.value = profile.namSinh;
      form.elements.gioiTinh.value = profile.gioiTinh;
      const restoreProfileForm = () => {
        form.elements.hoTen.value = profile.hoTen;
        form.elements.namSinh.value = profile.namSinh;
        form.elements.gioiTinh.value = profile.gioiTinh;
        form.elements.soThichId.value = profile.soThichId;
      };
      document.querySelector("#profileCancel").addEventListener("click", () => {
        restoreProfileForm();
        notify("Đã khôi phục thông tin ban đầu");
      });
      const summary = document.querySelector(".profile-summary");
      summary.querySelector(".large-avatar").textContent = initials(profile.hoTen);
      summary.querySelector("h2").textContent = profile.hoTen;
      summary.querySelector("p").textContent = `@${profile.tenDangNhap}`;
      summary.querySelector("dl dd").textContent = profile.maThanhVien;
      summary.querySelectorAll("dl dd")[1].textContent = new Date(profile.ngayTao).toLocaleDateString("vi-VN");
      form.addEventListener("submit", async event => {
        event.preventDefault(); const form = event.currentTarget; const button = form.querySelector("button[type='submit']"); button.dataset.label = "Lưu hồ sơ"; setFormBusy(form, true);
        try {
          const payload = formPayload(form); payload.namSinh = Number(payload.namSinh); payload.soThichId = Number(payload.soThichId);
          customerSession.profile = (await customerApi.updateMe(payload)).profile; notify("Đã cập nhật hồ sơ thành công"); render("profile");
        } catch (error) { notify(error.message); setFormBusy(form, false); }
      });
      const passwordForm = document.querySelector("#passwordForm");
      passwordForm.addEventListener("input", () => { document.querySelector("#passwordError").textContent = ""; });
      passwordForm.addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const payload = formPayload(form);
        const errorBox = document.querySelector("#passwordError");
        if (payload.matKhauMoi !== payload.matKhauMoiXacNhan) {
          errorBox.textContent = "Mật khẩu mới và phần xác nhận chưa khớp.";
          return;
        }
        if (payload.matKhauHienTai === payload.matKhauMoi) {
          errorBox.textContent = "Mật khẩu mới phải khác mật khẩu hiện tại.";
          return;
        }
        delete payload.matKhauMoiXacNhan;
        const button = form.querySelector("button[type='submit']");
        button.dataset.label = "Đổi mật khẩu";
        setFormBusy(form, true);
        try {
          await customerApi.updatePassword(payload);
          form.reset();
          notify("Đổi mật khẩu thành công");
          setFormBusy(form, false);
        } catch (error) {
          errorBox.textContent = error.message;
          setFormBusy(form, false);
        }
      });
    }

    if (view === "my-feedback") {
      document.querySelector("#feedbackDrink").innerHTML = `<option value="">Chọn đồ uống</option>${customerSession.options.drinks.map(item => `<option value="${item.id}">${escapeHtml(item.tenDoUong)}</option>`).join("")}`;
      const feedbackForm = document.querySelector("#feedbackForm");
      const feedbackError = document.querySelector("#feedbackError");
      document.querySelectorAll(".star-picker button").forEach((star, index, all) => star.addEventListener("click", () => {
        document.querySelector("#feedbackRating").value = star.dataset.rating;
        feedbackError.textContent = "";
        all.forEach((item, i) => item.classList.toggle("picked", i <= index));
      }));
      feedbackForm.addEventListener("input", () => { feedbackError.textContent = ""; });
      feedbackForm.addEventListener("submit", async event => {
        event.preventDefault();
        if (feedbackSubmitting) return;
        const form = event.currentTarget;
        const payload = formPayload(form);
        payload.doUongId = Number(payload.doUongId);
        payload.soSao = Number(payload.soSao);
        payload.noiDung = payload.noiDung.trim();
        if (!payload.doUongId) {
          feedbackError.textContent = "Vui lòng chọn đồ uống cần đánh giá.";
          return;
        }
        if (!payload.soSao) {
          feedbackError.textContent = "Vui lòng chọn mức độ hài lòng từ 1 đến 5 sao.";
          return;
        }
        if (payload.noiDung.length < 10) {
          feedbackError.textContent = "Nội dung phản hồi cần có ít nhất 10 ký tự.";
          return;
        }
        feedbackSubmitting = true;
        const button = form.querySelector("button[type='submit']");
        button.dataset.label = "Gửi phản hồi";
        setFormBusy(form, true);
        try {
          await customerApi.sendFeedback(payload);
          notify("Cảm ơn bạn! Phản hồi đã được gửi");
          feedbackSubmitting = false;
          render("my-feedback");
        } catch (error) {
          feedbackSubmitting = false;
          feedbackError.textContent = error.message;
          setFormBusy(form, false);
        }
      });
      let history = [];
      let historyError = null;
      try {
        history = (await customerApi.feedback()).feedback;
      } catch (error) {
        historyError = error;
      }
      const newCount = history.filter(item => item.trangThai === "moi").length;
      const handledCount = history.length - newCount;
      document.querySelector("#feedbackTotal").textContent = historyError ? "Chưa tải được" : `${history.length} phản hồi`;
      document.querySelector("#allFeedbackCount").textContent = historyError ? "—" : history.length;
      document.querySelector("#newFeedbackCount").textContent = historyError ? "—" : newCount;
      document.querySelector("#handledFeedbackCount").textContent = historyError ? "—" : handledCount;
      const renderFeedbackHistory = () => {
        if (historyError) {
          document.querySelector("#feedbackHistory").innerHTML = `<article class="history-card feedback-empty"><p>Chưa tải được lịch sử phản hồi. Bạn vẫn có thể gửi phản hồi mới ở biểu mẫu bên cạnh.</p></article>`;
          document.querySelector("#feedbackLoadMore").hidden = true;
          return;
        }
        const filtered = history.filter(item => customerSession.feedbackFilter === "all" ||
          (customerSession.feedbackFilter === "new" ? item.trangThai === "moi" : item.trangThai !== "moi"));
        const visible = filtered.slice(0, customerSession.feedbackVisible);
        document.querySelectorAll("[data-feedback-filter]").forEach(button => {
          const active = button.dataset.feedbackFilter === customerSession.feedbackFilter;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", String(active));
        });
        document.querySelector("#feedbackHistory").innerHTML = visible.length ? visible.map(item => {
          const status = item.trangThai === "moi" ? "Mới" : item.trangThai === "da_xem" ? "Đã xem" : "Đã tiếp thu";
          const sentAt = new Date(item.ngayGui).toLocaleString("vi-VN");
          const replyAt = item.ngayPhanHoi ? new Date(item.ngayPhanHoi).toLocaleString("vi-VN") : "";
          return `<article class="history-card"><div><strong>${escapeHtml(item.tenDoUong)}</strong><span class="status ${item.trangThai === "moi" ? "new" : "active"}">${status}</span></div><p>${escapeHtml(item.noiDung)}</p>${item.phanHoiCuaNhanVien ? `<div class="form-note feedback-reply"><div><strong>Phản hồi từ cửa hàng</strong>${replyAt ? `<time>${replyAt}</time>` : ""}</div><p>${escapeHtml(item.phanHoiCuaNhanVien)}</p></div>` : `<div class="feedback-awaiting">Cửa hàng đang tiếp nhận phản hồi của bạn.</div>`}<small>${"★".repeat(item.soSao)}${"☆".repeat(5-item.soSao)} · Đã gửi ${sentAt}</small></article>`;
        }).join("") : `<article class="history-card feedback-empty"><p>${history.length ? "Không có phản hồi phù hợp với bộ lọc này." : "Bạn chưa gửi phản hồi nào."}</p></article>`;
        const loadMore = document.querySelector("#feedbackLoadMore");
        loadMore.hidden = visible.length >= filtered.length;
        if (!loadMore.hidden) loadMore.textContent = `Xem thêm (${filtered.length - visible.length})`;
      };
      document.querySelectorAll("[data-feedback-filter]").forEach(button => button.addEventListener("click", () => {
        customerSession.feedbackFilter = button.dataset.feedbackFilter;
        customerSession.feedbackVisible = 5;
        renderFeedbackHistory();
      }));
      document.querySelector("#feedbackLoadMore").addEventListener("click", () => {
        customerSession.feedbackVisible += 5;
        renderFeedbackHistory();
      });
      renderFeedbackHistory();
    }

    if (view === "my-surveys") {
      const surveys = (await customerApi.surveys()).surveys;
      const list = document.querySelector("#surveyList");
      const isAvailable = survey => !survey.ngayHoanThanh && survey.trangThai === "dang_mo" &&
        (!survey.ngayKetThuc || new Date(survey.ngayKetThuc) > new Date());
      const pendingCount = surveys.filter(isAvailable).length;
      const completedCount = surveys.filter(survey => Boolean(survey.ngayHoanThanh)).length;
      document.querySelector("#pendingSurveyCount").textContent = pendingCount;
      document.querySelector("#completedSurveyFilterCount").textContent = completedCount;
      document.querySelector("#allSurveyCount").textContent = surveys.length;

      const openSurvey = async surveyId => {
        try {
          customerSession.currentSurvey = (await customerApi.survey(surveyId)).survey;
          customerSession.questionIndex = 0;
          customerSession.answers = validSurveyDraft(customerSession.currentSurvey);
          render("take-survey");
        } catch (error) { notify(error.message); }
      };
      const openCompletedSurvey = async surveyId => {
        try {
          customerSession.completedSurvey = (await customerApi.surveyResults(surveyId)).survey;
          clearSurveyDraft(Number(surveyId));
          render("completed-survey");
        } catch (error) { notify(error.message); }
      };
      const renderSurveyList = () => {
        const visibleSurveys = surveys.filter(survey => customerSession.surveyFilter === "all" ||
          (customerSession.surveyFilter === "pending" ? isAvailable(survey) : Boolean(survey.ngayHoanThanh)));
        document.querySelectorAll("[data-survey-filter]").forEach(button => {
          const active = button.dataset.surveyFilter === customerSession.surveyFilter;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", String(active));
        });
        list.innerHTML = visibleSurveys.length ? visibleSurveys.map((survey, index) => {
        const completed = Boolean(survey.ngayHoanThanh);
        const expired = survey.ngayKetThuc && new Date(survey.ngayKetThuc) <= new Date();
        const available = !completed && !expired && survey.trangThai === "dang_mo";
        const state = completed ? "Đã hoàn thành" : expired || survey.trangThai === "da_dong" ? "Đã đóng" : "Đang mở";
        const completionText = completed
          ? `Đã nộp ${new Date(survey.ngayHoanThanh).toLocaleString("vi-VN")}`
          : survey.ngayKetThuc ? `Hạn ${new Date(survey.ngayKetThuc).toLocaleDateString("vi-VN")}` : "Không giới hạn thời gian";
        return `<article class="panel my-survey ${available ? "featured" : ""}"><div class="survey-number ${completed ? "done" : ""}">${completed ? "✓" : String(index + 1).padStart(2,"0")}</div><div><span class="status ${available ? "active" : "locked"}">${state}</span><h2>${escapeHtml(survey.tieuDe)}</h2><p>${survey.soCauHoi} câu hỏi · ${completionText}</p></div>${available ? `<button class="primary survey-start" data-survey-id="${survey.id}">Thực hiện ngay →</button>` : completed ? `<button class="outline survey-result-open" data-survey-id="${survey.id}">Xem câu trả lời</button>` : `<button class="outline" disabled>Không khả dụng</button>`}</article>`;
        }).join("") : `<article class="panel empty-state"><span>✓</span><h2>${customerSession.surveyFilter === "pending" ? "Không có khảo sát đang chờ" : customerSession.surveyFilter === "completed" ? "Chưa hoàn thành khảo sát nào" : "Chưa có khảo sát"}</h2><p>${customerSession.surveyFilter === "pending" ? "Bạn đã xử lý tất cả khảo sát hiện có." : "Khi có dữ liệu phù hợp, khảo sát sẽ hiển thị tại đây."}</p></article>`;
        document.querySelectorAll(".survey-start").forEach(button => button.addEventListener("click", () => openSurvey(button.dataset.surveyId)));
        document.querySelectorAll(".survey-result-open").forEach(button => button.addEventListener("click", () => openCompletedSurvey(button.dataset.surveyId)));
      };
      document.querySelectorAll("[data-survey-filter]").forEach(button => button.addEventListener("click", () => {
        customerSession.surveyFilter = button.dataset.surveyFilter;
        renderSurveyList();
      }));
      renderSurveyList();
    }

    if (!customerSession.notifications.length || view === "notifications") {
      const previousNotifications = JSON.stringify(customerSession.notifications);
      const latestNotifications = (await customerApi.notifications()).notifications;
      customerSession.notifications = latestNotifications;
      if (view === "notifications" && previousNotifications !== JSON.stringify(latestNotifications)) {
        render("notifications");
        return;
      }
      const unread = customerSession.notifications.filter(item => !item.read).length;
      const count = document.querySelector("#notificationCount");
      if (count) count.textContent = unread;
      const notificationButton = document.querySelector(".top-actions .notification");
      notificationButton.classList.toggle("has-unread", unread > 0);
      notificationButton.setAttribute("aria-label", unread ? `Thông báo, ${unread} chưa đọc` : "Thông báo, không có mục chưa đọc");
    }

    if (view === "notifications") {
      document.querySelector("#notificationReadAll")?.addEventListener("click", async event => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = "Đang cập nhật...";
        try {
          await customerApi.readAllNotifications();
          customerSession.notifications.forEach(item => { item.read = true; });
          notify("Đã đánh dấu tất cả thông báo là đã đọc");
          render("notifications");
        } catch (error) {
          notify(error.message);
          button.disabled = false;
          button.textContent = "✓ Đánh dấu tất cả đã đọc";
        }
      });
      document.querySelectorAll(".notification-read").forEach(button => button.addEventListener("click", async () => {
        try {
          await customerApi.readNotification(button.dataset.id);
          const item = customerSession.notifications.find(entry => String(entry.id) === String(button.dataset.id));
          if (item) item.read = true;
          render("notifications");
        } catch (error) { notify(error.message); }
      }));
      document.querySelectorAll(".notification-open").forEach(button => button.addEventListener("click", async () => {
        try {
          await customerApi.readNotification(button.dataset.id);
          const item = customerSession.notifications.find(entry => String(entry.id) === String(button.dataset.id));
          if (item) item.read = true;
          render(customerViews[button.dataset.link] ? button.dataset.link : "notifications");
        } catch (error) { notify(error.message); }
      }));
      document.querySelector("#notificationLoadMore")?.addEventListener("click", () => {
        customerSession.notificationVisible += 8;
        render("notifications");
      });
    }

    if (view === "help") {
      const search = document.querySelector("#helpSearch");
      const renderHelpTopics = () => {
        const query = normalizeSearchText(search.value);
        customerSession.helpQuery = search.value.trim();
        const topics = customerHelpTopics.filter(topic => normalizeSearchText(`${topic.category} ${topic.title} ${topic.content}`).includes(query));
        document.querySelector("#helpResultTitle").textContent = query ? `Kết quả cho “${customerSession.helpQuery}”` : "Tất cả hướng dẫn";
        document.querySelector("#helpResultCount").textContent = `${topics.length} mục`;
        document.querySelector("#helpTopics").innerHTML = topics.length ? topics.map((topic, index) => `<details class="panel help-topic" ${query && index === 0 ? "open" : ""}><summary><span>${escapeHtml(topic.category)}</span><strong>${escapeHtml(topic.title)}</strong><i>＋</i></summary><p>${escapeHtml(topic.content)}</p></details>`).join("") : `<article class="panel empty-state"><span>⌕</span><h2>Không tìm thấy hướng dẫn</h2><p>Thử từ khóa ngắn hơn hoặc gửi yêu cầu hỗ trợ cho cửa hàng.</p><button class="primary" data-view="my-feedback">Gửi yêu cầu hỗ trợ</button></article>`;
      };
      search.addEventListener("input", renderHelpTopics);
      renderHelpTopics();
      search.focus();
    }

    if (view === "take-survey" && customerSession.currentSurvey) {
      const survey = customerSession.currentSurvey;
      const captureCurrentAnswer = () => {
        const question = survey.questions[customerSession.questionIndex];
        const selected = document.querySelector("input[name='answer']:checked");
        if (selected) {
          customerSession.answers = customerSession.answers.filter(item => item.cauHoiId !== question.id);
          customerSession.answers.push({ cauHoiId: question.id, luaChonId: Number(selected.value) });
          saveSurveyDraft(survey.id);
        }
        return selected;
      };
      document.querySelectorAll("input[name='answer']").forEach(input => input.addEventListener("change", captureCurrentAnswer));
      document.querySelector("#previousQuestion")?.addEventListener("click", () => {
        captureCurrentAnswer();
        customerSession.questionIndex -= 1;
        render("take-survey");
      });
      const submitDialog = document.querySelector("#surveySubmitDialog");
      document.querySelector("#surveySubmitCancel")?.addEventListener("click", () => submitDialog.close());
      document.querySelector("#nextQuestion")?.addEventListener("click", () => {
        const question = survey.questions[customerSession.questionIndex];
        const selected = captureCurrentAnswer();
        if (!selected && question.batBuoc) { notify("Vui lòng chọn một câu trả lời"); return; }
        if (customerSession.questionIndex < survey.questions.length - 1) { customerSession.questionIndex += 1; render("take-survey"); return; }
        submitDialog.showModal();
      });
      document.querySelector("#surveySubmitConfirm")?.addEventListener("click", async event => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = "Đang gửi...";
        try {
          await customerApi.submitSurvey(survey.id, customerSession.answers); notify("Nộp khảo sát thành công");
          clearSurveyDraft(survey.id);
          submitDialog.close();
          customerSession.currentSurvey = null; customerSession.questionIndex = 0; customerSession.answers = []; render("my-surveys");
        } catch (error) {
          notify(error.message);
          button.disabled = false;
          button.textContent = "Xác nhận gửi";
        }
      });
    }
  } catch (error) {
    notify(error.message);
    if (error.status === 401) { customerSession.profile = null; customerApi.logout(); applyRole("customer"); }
  }
}

/* ══════════════════════════════════════════════════════════════════════
   INTERNAL PORTAL SETUP (ADMIN & MANAGER)
   ══════════════════════════════════════════════════════════════════════ */
async function setupInternalPage(view, renderVersion) {
  if (currentRole === "customer") return;

  if (view === "internal-login") {
    document.querySelector("#internalLoginForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      setFormBusy(form, true);
      try {
        const data = await internalApi.login(formPayload(form));
        if (data.account.role !== internalApi.portal) {
          internalApi.logout();
          throw new Error(`Tài khoản này thuộc cổng ${data.account.role === "admin" ? "Admin" : "Manager"}. Vui lòng mở đúng đường dẫn.`);
        }
        internalSession.account = data.account;
        internalSession.loaded.clear();
        currentRole = data.account.role;
        document.body.dataset.role = currentRole;
        notify("Đăng nhập nội bộ thành công");
        applyRole(currentRole);
      } catch (error) {
        document.querySelector("#internalAuthError").textContent = error.message;
        setFormBusy(form, false);
      }
    });
    return;
  }

  if (!internalApi.hasToken()) { render("internal-login"); return; }

  try {
    if (!internalSession.account) internalSession.account = (await internalApi.me()).account;
    if (internalSession.account.role !== internalApi.portal) {
      internalApi.logout();
      internalSession.account = null;
      throw Object.assign(new Error(`Phiên đăng nhập không thuộc cổng ${internalApi.portal === "admin" ? "Admin" : "Manager"}`), { status: 403 });
    }

    const loaders = {
      "admin-dashboard": async () => {
        const [dData, mData, rData] = await Promise.all([
          internalApi.dashboard(), internalApi.managers(), internalApi.customerRequests()
        ]);
        internalSession.dashboard = dData;
        internalSession.managers = mData.managers;
        internalSession.customerRequests = rData.requests;
      },
      dashboard: async () => {
        const [dashData, custList, fbList, reqList] = await Promise.all([
          internalApi.dashboard(), internalApi.customers(), internalApi.feedback(), internalApi.customerRequests()
        ]);
        internalSession.dashboard = dashData;
        internalSession.customers = custList.customers;
        internalSession.feedback = fbList.feedback;
        internalSession.customerRequests = reqList.requests;
      },
      customers: async () => {
        const [custList, catList] = await Promise.all([internalApi.customers(), internalApi.catalogs()]);
        internalSession.customers = custList.customers;
        internalSession.catalogs = catList;
      },
      dashboard: async () => { internalSession.dashboard = await internalApi.dashboard(); },
      customers: async () => {
        const [customerData, catalogs] = await Promise.all([
          internalApi.customers(),
          currentRole === "manager" && !internalSession.catalogs ? internalApi.catalogs() : Promise.resolve(internalSession.catalogs)
        ]);
        internalSession.customers = customerData.customers;
        if (catalogs) internalSession.catalogs = catalogs;
      },
      "create-customer": async () => { internalSession.catalogs ||= await internalApi.catalogs(); },
      "customer-requests": async () => { internalSession.customerRequests = (await internalApi.customerRequests()).requests; },
      feedback: async () => { internalSession.feedback = (await internalApi.feedback()).feedback; },
      surveys: async () => { internalSession.surveys = (await internalApi.surveys()).surveys; },
      "create-survey": async () => {
        const [custList, catList] = await Promise.all([internalApi.customers(), internalApi.catalogs()]);
        internalSession.customers = custList.customers;
        internalSession.catalogs = catList;
      },
      reports: async () => {
        const [repData, custList, survList, fbList] = await Promise.all([
          internalApi.customerReports(), internalApi.customers(), internalApi.surveys(), internalApi.feedback()
        ]);
        internalSession.reports = repData;
        internalSession.customers = custList.customers;
        internalSession.surveys = survList.surveys;
        internalSession.feedback = fbList.feedback;
      },
      accounts: async () => { internalSession.managers = (await internalApi.managers()).managers; },
      catalog: async () => { internalSession.catalogs = await internalApi.catalogs(); },
      "admin-catalog": async () => { internalSession.catalogs = await internalApi.catalogs(); }
    };

    if (loaders[view] && !internalSession.loaded.has(view)) {
      await loaders[view]();
      internalSession.loaded.add(view);
      if (renderVersion !== navigationVersion) return;
      render(view);
      return;
    }

    if (!internalSession.dashboard) internalSession.dashboard = await internalApi.dashboard();

    // Cập nhật các con số huy hiệu trên Sidebar
    const customerCountEl = document.querySelector("#customerCount");
    const feedbackCountEl = document.querySelector("#feedbackCount");
    const managerReqBadgeEl = document.querySelector("#managerReqBadge");

    if (customerCountEl) customerCountEl.textContent = internalSession.customers.length || internalSession.dashboard.summary.totalCustomers;
    if (feedbackCountEl) {
      const moiFB = internalSession.feedback.filter(f => f.status === "moi").length;
      feedbackCountEl.textContent = moiFB;
      feedbackCountEl.style.display = moiFB > 0 ? "inline-block" : "none";
    }
    if (managerReqBadgeEl) {
      const pendingReq = internalSession.customerRequests.filter(r => r.status === "pending").length;
      managerReqBadgeEl.textContent = pendingReq;
      managerReqBadgeEl.hidden = pendingReq === 0;
    }

    const name = internalSession.account.tenDangNhap;
    document.querySelector("#userInitials").textContent = initials(name);
    document.querySelector("#userName").textContent = name;
    document.querySelector("#userRole").textContent = internalSession.account.role === "admin" ? "Quản trị viên" : "Manager";
    if (view === "admin-catalog") {
      const dialog = document.querySelector("#drinkDialog");
      const form = document.querySelector("#drinkForm");
      document.querySelector("#openDrinkDialog")?.addEventListener("click", () => dialog.showModal());
      document.querySelector("#cancelDrink")?.addEventListener("click", () => dialog.close());
      dialog?.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
      form?.addEventListener("input", () => { document.querySelector("#drinkError").textContent = ""; });
      form?.addEventListener("submit", async event => {
        event.preventDefault();
        const payload = formPayload(form);
        payload.maDoUong = payload.maDoUong.trim().toLocaleUpperCase();
        const button = form.querySelector("button[type='submit']");
        button.dataset.label = "Thêm đồ uống";
        setFormBusy(form, true);
        try {
          await internalApi.createDrink(payload);
          internalSession.catalogs = await internalApi.catalogs();
          customerSession.options = null;
          dialog.close();
          notify("Đã thêm đồ uống và cập nhật danh sách đánh giá");
          render("admin-catalog");
        } catch (error) {
          document.querySelector("#drinkError").textContent = error.message;
          setFormBusy(form, false);
        }
      });
      document.querySelectorAll(".drink-status").forEach(button => button.addEventListener("click", async () => {
        const active = button.dataset.active === "true";
        const action = active ? "mở bán lại" : "ngừng bán";
        if (!window.confirm(`Bạn có chắc muốn ${action} món này?`)) return;
        button.disabled = true;
        try {
          await internalApi.updateDrinkStatus(button.dataset.id, active);
          internalSession.catalogs = await internalApi.catalogs();
          customerSession.options = null;
          notify(active ? "Đã mở bán lại đồ uống" : "Đã ngừng bán; lịch sử đánh giá vẫn được giữ");
          render("admin-catalog");
        } catch (error) {
          notify(error.message);
          button.disabled = false;
        }
      }));
    }
    document.querySelector("#createCustomerForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = formPayload(form);
      payload.namSinh = Number(payload.namSinh);
      payload.soThichId = Number(payload.soThichId);
      setFormBusy(form, true);
      try {
        await internalApi.createCustomer(payload);
        internalSession.loaded.delete("customers");
        internalSession.loaded.delete("dashboard");
        notify("Đã thêm khách hàng mới thành công");
        render("customers");
      } catch (error) {
        document.querySelector("#createCustomerError").textContent = error.message;
        setFormBusy(form, false);
      }
    });

    /* ── 2. Bộ lọc & Sửa hồ sơ khách hàng / Đề xuất khóa ───────────────── */
    const customerEditDialog = document.querySelector("#customerEditDialog");
    const customerEditForm = document.querySelector("#customerEditForm");
    const customerLockDialog = document.querySelector("#customerLockDialog");
    const customerLockForm = document.querySelector("#customerLockForm");

    // Lọc realtime danh sách khách hàng
    const applyCustomerFilters = () => {
      const q = document.querySelector("#customerSearchInput")?.value || "";
      const reg = document.querySelector("#customerRegionFilter")?.value || "";
      const pref = document.querySelector("#customerPrefFilter")?.value || "";
      const st = document.querySelector("#customerStatusFilter")?.value || "";
      internalSession.customerFilters = { query: q, region: reg, preference: pref, status: st };
      render("customers");
    };

    document.querySelector("#customerSearchInput")?.addEventListener("input", e => {
      internalSession.customerFilters.query = e.target.value;
      const filtered = internalSession.customers.filter(c => {
        const q = e.target.value.toLowerCase();
        const reg = getCustomerRegion(c);
        if (internalSession.customerFilters.region && reg !== internalSession.customerFilters.region) return false;
        if (internalSession.customerFilters.preference && String(c.preferenceId) !== String(internalSession.customerFilters.preference)) return false;
        if (internalSession.customerFilters.status && c.status !== internalSession.customerFilters.status) return false;
        return `${c.name} ${c.code} ${c.username || ""} ${c.preference || ""}`.toLowerCase().includes(q);
      });
      document.querySelector("#customerResults").innerHTML = filtered.length
        ? customerTable(filtered, true)
        : `<article class="panel empty-state"><h2>Không tìm thấy khách hàng phù hợp</h2></article>`;
    });

    document.querySelector("#customerRegionFilter")?.addEventListener("change", applyCustomerFilters);
    document.querySelector("#customerPrefFilter")?.addEventListener("change", applyCustomerFilters);
    document.querySelector("#customerStatusFilter")?.addEventListener("change", applyCustomerFilters);

    // Mở Modal Sửa hồ sơ khách hàng
    document.querySelectorAll(".customer-edit-btn").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.id;
        const customer = internalSession.customers.find(c => String(c.id) === String(id));
        if (!customer) return;

        customerEditForm.dataset.id = customer.id;
        document.querySelector("#editCustomerName").value = customer.name;
        document.querySelector("#editCustomerBirthYear").value = customer.birth_year || customer.birthYear || (new Date().getFullYear() - customer.age);
        document.querySelector("#editCustomerGender").value = customer.gender || "khong_cung_cap";
        document.querySelector("#editCustomerPreference").value = customer.preferenceId || "";
        document.querySelector("#editCustomerRegion").value = getCustomerRegion(customer);
        document.querySelector("#customerEditError").textContent = "";
        customerEditDialog.showModal();
      });
    });

    document.querySelector("#customerEditCancel")?.addEventListener("click", () => customerEditDialog.close());

    // Submit Sửa hồ sơ khách hàng
    customerEditForm?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const id = form.dataset.id;
      const payload = {
        hoTen: form.elements.hoTen.value.trim(),
        namSinh: Number(form.elements.namSinh.value),
        gioiTinh: form.elements.gioiTinh.value,
        soThichId: Number(form.elements.soThichId.value)
      };
      setFormBusy(form, true);
      try {
        await internalApi.updateCustomer(id, payload);
        // Lưu phân vùng vào bộ nhớ
        const cObj = internalSession.customers.find(c => String(c.id) === String(id));
        if (cObj) cObj.region = form.elements.phanVung.value;

        internalSession.loaded.delete("customers");
        internalSession.loaded.delete("dashboard");
        notify("Đã cập nhật hồ sơ khách hàng thành công");
        customerEditDialog.close();
        render("customers");
      } catch (error) {
        document.querySelector("#customerEditError").textContent = error.message;
        setFormBusy(form, false);
      }
    });

    // Mở Modal Đề xuất khóa / mở khóa khách hàng
    document.querySelectorAll(".customer-lock-btn").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.id;
        const action = button.dataset.action || "lock_customer";
        const isUnlock = action === "unlock_customer";
        const customer = internalSession.customers.find(c => String(c.id) === String(id));
        if (!customer) return;

        customerLockForm.dataset.id = customer.id;
        customerLockForm.dataset.action = action;

        // Cập nhật giao diện modal tương ứng với hành động
        document.querySelector("#lockDialogTitle").textContent = isUnlock
          ? "Đề xuất mở khóa tài khoản khách hàng"
          : "Đề xuất khóa tài khoản khách hàng";

        document.querySelector("#lockDialogSubtitle").textContent = isUnlock
          ? "Yêu cầu mở khóa sẽ được chuyển đến Admin xem xét và phê duyệt phục hồi tài khoản."
          : "Yêu cầu khóa sẽ được chuyển đến Admin xem xét và phê duyệt trước khi thi hành.";

        document.querySelector("#lockReasonLabel").textContent = isUnlock
          ? "Lý do đề xuất mở khóa (bắt buộc) *"
          : "Lý do đề xuất khóa (bắt buộc) *";

        const reasonInput = document.querySelector("#lockDialogReason");
        reasonInput.value = "";
        reasonInput.placeholder = isUnlock
          ? "Mô tả lý do mở lại tài khoản (ví dụ: đã giải quyết xong khiếu nại, hết thời hạn phạt, khách hàng cam kết không tái phạm)..."
          : "Mô tả hành vi vi phạm của khách hàng (ví dụ: spam đánh giá tiêu cực, quấy rối nhân viên, vi phạm điều khoản chính sách)...";

        const submitBtn = document.querySelector("#lockDialogSubmitBtn");
        submitBtn.textContent = isUnlock ? "Gửi đề xuất mở khóa lên Admin" : "Gửi đề xuất khóa lên Admin";
        submitBtn.style.background = isUnlock ? "var(--green)" : "#c04a36";
        submitBtn.style.borderColor = isUnlock ? "var(--green)" : "#c04a36";

        document.querySelector("#lockDialogAvatar").textContent = initials(customer.name);
        document.querySelector("#lockDialogName").textContent = customer.name;
        document.querySelector("#lockDialogCode").textContent = `Mã TV: ${customer.code} · ${regionLabel(getCustomerRegion(customer))} · Trạng thái: ${statusLabel(customer.status)}`;
        document.querySelector("#lockReasonCount").textContent = "0";
        document.querySelector("#customerLockError").textContent = "";
        customerLockDialog.showModal();
      });
    });

    document.querySelector("#lockDialogReason")?.addEventListener("input", e => {
      document.querySelector("#lockReasonCount").textContent = e.target.value.length;
    });

    document.querySelector("#customerLockCancel")?.addEventListener("click", () => customerLockDialog.close());

    // Submit Đề xuất khóa / mở khóa khách hàng
    customerLockForm?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const id = form.dataset.id;
      const action = form.dataset.action || "lock_customer";
      const isUnlock = action === "unlock_customer";
      const reason = document.querySelector("#lockDialogReason").value.trim();
      setFormBusy(form, true);
      try {
        await internalApi.createCustomerRequest({
          customerId: Number(id),
          action,
          reason
        });
        internalSession.loaded.delete("customer-requests");
        internalSession.loaded.delete("dashboard");
        notify(isUnlock ? "Đã gửi đề xuất mở khóa lên Admin chờ phê duyệt" : "Đã gửi đề xuất khóa lên Admin chờ phê duyệt");
        customerLockDialog.close();
        render("customers");
      } catch (error) {
        document.querySelector("#customerLockError").textContent = error.message;
        setFormBusy(form, false);
      }
    });

    /* ── 3. Quản lý phản hồi 3 bước & Trả lời ─────────────────────────── */
    const feedbackModal = document.querySelector("#feedbackModal");
    const feedbackModalForm = document.querySelector("#feedbackModalForm");
    let currentFeedbackStatusVal = "moi";

    // Lọc phản hồi
    const applyFeedbackFilters = () => {
      internalSession.feedbackFilters = {
        status: document.querySelector("#feedbackStatusSelect")?.value || "",
        rating: document.querySelector("#feedbackRatingSelect")?.value || "",
        query: document.querySelector("#feedbackSearchInput")?.value || ""
      };
      render("feedback");
    };

    document.querySelector("#feedbackStatusSelect")?.addEventListener("change", applyFeedbackFilters);
    document.querySelector("#feedbackRatingSelect")?.addEventListener("change", applyFeedbackFilters);
    document.querySelector("#feedbackSearchInput")?.addEventListener("input", e => {
      internalSession.feedbackFilters.query = e.target.value;
      const q = e.target.value.toLowerCase();
      const filtered = internalSession.feedback.filter(item => {
        if (internalSession.feedbackFilters.status && item.status !== internalSession.feedbackFilters.status) return false;
        return `${item.customerName} ${item.drinkName} ${item.content} ${item.reply || ""}`.toLowerCase().includes(q);
      });
      // Render lại danh sách thẻ
      const container = document.querySelector("#feedbackCards");
      if (container) {
        container.innerHTML = filtered.length ? filtered.map(item => `
          <article class="feedback-card feedback-clickable" data-id="${item.id}">
            <div class="avatar mint">${initials(item.customerName)}</div>
            <div class="feedback-body">
              <div><strong>${escapeHtml(item.customerName)}</strong><span>• ${escapeHtml(item.drinkName)}</span></div>
              <div class="stars">${"★".repeat(item.rating)}${"☆".repeat(5 - item.rating)}</div>
              <p>“${escapeHtml(item.content)}”</p>
              ${item.reply ? `<div class="form-note"><strong>Phản hồi từ quản lý:</strong> ${escapeHtml(item.reply)}</div>` : ""}
              <small>${formatDateTime(item.sentAt)}</small>
            </div>
            <div class="feedback-actions">
              <span class="status ${item.status}">${statusLabel(item.status)}</span>
              <button class="outline" style="font-size:10px">${item.status === "da_tiep_thu" ? "Xem chi tiết" : "Xử lý & Trả lời →"}</button>
            </div>
          </article>
        `).join("") : `<article class="panel empty-state"><h2>Không tìm thấy phản hồi</h2></article>`;
      }
    });

    // Mở modal xử lý phản hồi
    document.querySelector("#feedbackCards")?.addEventListener("click", e => {
      const card = e.target.closest(".feedback-clickable");
      if (!card) return;
      const id = card.dataset.id;
      const item = internalSession.feedback.find(f => String(f.id) === String(id));
      if (!item) return;

      feedbackModalForm.dataset.id = item.id;
      currentFeedbackStatusVal = item.status === "moi" ? "da_xem" : item.status; // Gợi ý bước tiếp theo
      document.querySelector("#feedbackModalMeta").textContent = `Khách hàng: ${item.customerName} · Đồ uống: ${item.drinkName} · Gửi lúc: ${formatDateTime(item.sentAt)}`;

      document.querySelector("#feedbackModalOriginal").innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>Đánh giá:</strong>
          <span class="stars">${"★".repeat(item.rating)}${"☆".repeat(5 - item.rating)}</span>
        </div>
        <blockquote>“${escapeHtml(item.content)}”</blockquote>
      `;

      // Cập nhật các nút trạng thái 3 bước
      document.querySelectorAll(".feedback-status-step").forEach(step => {
        const val = step.dataset.val;
        step.classList.toggle("sel", val === currentFeedbackStatusVal);
      });

      document.querySelector("#feedbackModalReply").value = item.reply || "";
      document.querySelector("#feedbackModalError").textContent = "";
      feedbackModal.showModal();
    });

    document.querySelectorAll(".feedback-status-step").forEach(step => {
      step.addEventListener("click", () => {
        currentFeedbackStatusVal = step.dataset.val;
        document.querySelectorAll(".feedback-status-step").forEach(s => s.classList.toggle("sel", s === step));
      });
    });

    document.querySelector("#feedbackModalCancel")?.addEventListener("click", () => feedbackModal.close());

    // Submit cập nhật phản hồi
    feedbackModalForm?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const id = form.dataset.id;
      const reply = document.querySelector("#feedbackModalReply").value.trim();
      setFormBusy(form, true);
      try {
        if (statusButton) {
          const customer = internalSession.customers.find(item => String(item.id) === String(customerId));
          if (!customer) throw new Error("Không tìm thấy hồ sơ khách hàng cần cập nhật.");
          openAccountStatusModal("customer", customerId, statusButton.dataset.status, customer.name);
          return;
        } else if (editButton) {
          const customer = internalSession.customers.find(item => String(item.id) === String(customerId));
          if (!customer) throw new Error("Không tìm thấy hồ sơ khách hàng cần cập nhật.");
          const dialog = document.querySelector("#customerEditDialog");
          const form = document.querySelector("#customerEditForm");
          form.dataset.id = customerId;
          form.elements.hoTen.value = customer.name || "";
          form.elements.namSinh.value = customer.birth_year || "";
          form.elements.gioiTinh.value = customer.gender || "khong_cung_cap";
          form.elements.soThichId.value = customer.preferenceId || "";
          document.querySelector("#customerEditAvatar").textContent = initials(customer.name);
          document.querySelector("#customerEditSummary").textContent = customer.name || "Khách hàng CRM";
          document.querySelector("#customerEditCode").textContent = customer.code || "—";
          document.querySelector("#customerEditUsername").textContent = customer.username || "—";
          document.querySelector("#customerEditStatus").textContent = statusLabel(customer.status);
          document.querySelector("#customerEditError").textContent = "";
          dialog.showModal();
          form.elements.hoTen.focus();
          return;
        } else if (requestButton) {
          const reason = window.prompt(`Lý do yêu cầu khóa tài khoản "${actionButton.dataset.name}":`);
          if (reason === null) return;
          await internalApi.createCustomerRequest({ customerId: Number(customerId), action: "lock_customer", reason });
          internalSession.loaded.delete("customer-requests");
          notify("Đã gửi yêu cầu khóa đến Admin");
        } else {
          return;
        }
        internalSession.loaded.delete("customers");
        internalSession.loaded.delete("admin-dashboard");
        internalSession.loaded.delete("dashboard");
        notify("Đã cập nhật trạng thái phản hồi & gửi thông báo đến khách hàng");
        feedbackModal.close();
        render("feedback");
      } catch (error) {
        document.querySelector("#feedbackModalError").textContent = error.message;
        setFormBusy(form, false);
      }
    });

    /* ── 4. Khảo sát sản phẩm mới: Lọc tệp & Anti-spam ─────────────────── */
    if (view === "create-survey") {
      const form = document.querySelector("#bulkSurveyForm");
      const targetModeInputs = document.querySelectorAll("input[name='targetMode']");
      const filterBox = document.querySelector("#surveyFilterBox");
      const manualBox = document.querySelector("#surveyManualBox");
      const counterEl = document.querySelector("#recipientCountDisplay");
      const spamNotice = document.querySelector("#spamNotice");

      const updateTargetCounts = () => {
        const mode = form.querySelector("input[name='targetMode']:checked")?.value || "all";
        filterBox.style.display = mode === "filtered" ? "block" : "none";
        manualBox.style.display = mode === "manual" ? "block" : "none";

        let count = 0;
        const activeCusts = internalSession.customers.filter(c => c.status === "active");

        if (mode === "all") {
          count = activeCusts.length;
        } else if (mode === "manual") {
          const select = document.querySelector("#surveyRecipients");
          count = [...select.selectedOptions].length;
        } else if (mode === "filtered") {
          const prefVal = document.querySelector("#surveyFilterPref")?.value;
          const ageVal = document.querySelector("#surveyFilterAge")?.value;
          const regVal = document.querySelector("#surveyFilterRegion")?.value;

          const matched = activeCusts.filter(c => {
            if (prefVal && String(c.preferenceId) !== String(prefVal)) return false;
            if (regVal && getCustomerRegion(c) !== regVal) return false;
            if (ageVal) {
              const age = c.age || (new Date().getFullYear() - (c.birth_year || c.birthYear || 2000));
              if (ageVal === "under18" && age >= 18) return false;
              if (ageVal === "18_24" && (age < 18 || age > 24)) return false;
              if (ageVal === "25_35" && (age < 25 || age > 35)) return false;
              if (ageVal === "over35" && age <= 35) return false;
            }
            return true;
          });
          count = matched.length;
        }

        if (counterEl) counterEl.textContent = count;
        // Kiểm soát hạn mức chống spam
        if (spamNotice) {
          if (count > 50) {
            spamNotice.style.background = "#fff2e8";
            spamNotice.style.borderColor = "#fa8c16";
            spamNotice.innerHTML = `
              <span class="icon" style="color:#d4380d">⚠️</span>
              <div>
                <strong style="color:#d4380d">Cảnh báo hạn mức gửi diện rộng (${count} khách):</strong>
                <span>Để tránh làm phiền khách hàng (Spam Policy), khuyến nghị chỉ chọn tệp mục tiêu quan tâm sản phẩm mới hoặc gửi theo từng đợt ≤ 50 khách.</span>
              </div>
            `;
          } else {
            spamNotice.style.background = "#fff8ec";
            spamNotice.style.borderColor = "#f2d68f";
            spamNotice.innerHTML = `
              <span class="icon">🛡️</span>
              <div>
                <strong>Tệp mục tiêu an toàn (${count} khách):</strong>
                <span>Số lượng người nhận nằm trong ngưỡng khuyến nghị của hệ thống.</span>
              </div>
            `;
          }
        }
      };

      targetModeInputs.forEach(i => i.addEventListener("change", updateTargetCounts));
      document.querySelector("#surveyFilterPref")?.addEventListener("change", updateTargetCounts);
      document.querySelector("#surveyFilterAge")?.addEventListener("change", updateTargetCounts);
      document.querySelector("#surveyFilterRegion")?.addEventListener("change", updateTargetCounts);
      document.querySelector("#surveyRecipients")?.addEventListener("change", updateTargetCounts);

      // Thêm câu hỏi
      document.querySelector("#addSurveyQuestion")?.addEventListener("click", () => {
        const qCount = document.querySelectorAll(".survey-question-input").length + 1;
        document.querySelector("#surveyQuestions").insertAdjacentHTML("beforeend", `
          <div class="form-grid survey-question-input">
            <label style="flex:2">
              Câu hỏi ${qCount} *
              <input name="question" minlength="3" placeholder="Nhập nội dung câu hỏi..." required />
            </label>
            <label style="flex:2">
              Các lựa chọn trắc nghiệm *
              <input name="choices" maxlength="5000" placeholder="Lựa chọn 1; Lựa chọn 2; Lựa chọn 3" required />
            </label>
            <button type="button" class="outline remove-survey-question" style="align-self:end;margin-bottom:2px">Xóa</button>
          </div>
        `);
      });

      document.querySelector("#surveyQuestions")?.addEventListener("click", e => {
        if (e.target.closest(".remove-survey-question")) {
          if (document.querySelectorAll(".survey-question-input").length <= 1) {
            notify("Khảo sát phải có ít nhất một câu hỏi");
            return;
          }
          e.target.closest(".survey-question-input").remove();
        }
      });

      // Submit Tạo khảo sát
      form?.addEventListener("submit", async event => {
        event.preventDefault();
        const payload = formPayload(form);
        const questions = [...form.querySelectorAll(".survey-question-input")].map(row => ({
          content: row.querySelector('[name="question"]').value.trim(),
          choices: row.querySelector('[name="choices"]').value.split(";").map(v => v.trim()).filter(Boolean)
        }));

        const deadline = payload.endAt ? new Date(payload.endAt) : null;
        if (deadline && (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now())) {
          document.querySelector("#surveyError").textContent = "Hạn khảo sát phải là thời điểm trong tương lai.";
          return;
        }

        const mode = form.querySelector("input[name='targetMode']:checked")?.value || "all";
        let targetCustomerIds = null;
        const activeCusts = internalSession.customers.filter(c => c.status === "active");

        if (mode === "manual") {
          const select = document.querySelector("#surveyRecipients");
          targetCustomerIds = [...select.selectedOptions].map(o => Number(o.value));
          if (!targetCustomerIds.length) {
            document.querySelector("#surveyError").textContent = "Vui lòng chọn ít nhất một khách hàng nhận khảo sát.";
            return;
          }
        } else if (mode === "filtered") {
          const prefVal = document.querySelector("#surveyFilterPref")?.value;
          const ageVal = document.querySelector("#surveyFilterAge")?.value;
          const regVal = document.querySelector("#surveyFilterRegion")?.value;

          const matched = activeCusts.filter(c => {
            if (prefVal && String(c.preferenceId) !== String(prefVal)) return false;
            if (regVal && getCustomerRegion(c) !== regVal) return false;
            if (ageVal) {
              const age = c.age || (new Date().getFullYear() - (c.birth_year || c.birthYear || 2000));
              if (ageVal === "under18" && age >= 18) return false;
              if (ageVal === "18_24" && (age < 18 || age > 24)) return false;
              if (ageVal === "25_35" && (age < 25 || age > 35)) return false;
              if (ageVal === "over35" && age <= 35) return false;
            }
            return true;
          });
          targetCustomerIds = matched.map(c => c.id);
          if (!targetCustomerIds.length) {
            document.querySelector("#surveyError").textContent = "Không có khách hàng nào phù hợp với bộ lọc tiêu chí.";
            return;
          }
        }

        setFormBusy(form, true);
        try {
          const res = await internalApi.createSurvey({
            title: payload.title,
            description: payload.description || undefined,
            endAt: deadline ? deadline.toISOString() : null,
            questions,
            customerIds: targetCustomerIds
          });
          internalSession.loaded.delete("surveys");
          internalSession.loaded.delete("dashboard");
          notify(`Đã phát hành và gửi khảo sát thành công đến ${res.recipients} khách hàng!`);
          render("surveys");
        } catch (error) {
          document.querySelector("#surveyError").textContent = error.message;
          setFormBusy(form, false);
        }
      });
    }

    if (view === "edit-survey") {
      const form = document.querySelector("#editSurveyForm");
      form?.addEventListener("submit", async event => {
        event.preventDefault();
        const payload = formPayload(form);
        const questions = [...form.querySelectorAll(".survey-question-input")].map(row => ({
          content: row.querySelector('[name="question"]').value.trim(),
          choices: row.querySelector('[name="choices"]').value.split(";").map(v => v.trim()).filter(Boolean)
        }));
        const deadline = payload.endAt ? new Date(payload.endAt) : null;
        setFormBusy(form, true);
        try {
          await internalApi.updateSurvey(form.dataset.id, {
            title: payload.title,
            endAt: deadline ? deadline.toISOString() : null,
            questions
          });
          internalSession.loaded.delete("surveys");
          notify("Đã lưu thay đổi khảo sát");
          render("surveys");
        } catch (error) {
          document.querySelector("#surveyError").textContent = error.message;
          setFormBusy(form, false);
        }
      });
    }

    // Các nút khảo sát
    document.querySelectorAll(".survey-edit").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        internalSession.editSurvey = (await internalApi.survey(button.dataset.id)).survey;
        render("edit-survey");
      } catch (error) { notify(error.message); button.disabled = false; }
    }));

    document.querySelectorAll(".survey-visibility").forEach(button => button.addEventListener("click", async () => {
      const hidden = button.dataset.hidden === "true";
      if (!window.confirm(`Bạn có chắc muốn ${hidden ? "ẩn" : "khôi phục"} khảo sát này?`)) return;
      try {
        await internalApi.setSurveyVisibility(button.dataset.id, hidden);
        internalSession.loaded.delete("surveys");
        notify(hidden ? "Đã ẩn khảo sát" : "Đã khôi phục khảo sát");
        render("surveys");
      } catch (error) { notify(error.message); }
    }));

    document.querySelectorAll(".survey-results").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        internalSession.surveyResults = await internalApi.surveyResults(button.dataset.id);
        render("survey-results");
      } catch (error) { notify(error.message); button.disabled = false; }
    }));

    document.querySelector("#printSurveyResultBtn")?.addEventListener("click", () => window.print());

    /* ── 5. Khai thác báo cáo: Xuất Excel & PDF ─────────────────────────── */
    document.querySelector("#exportExcelBtn")?.addEventListener("click", exportReportExcel);
    document.querySelector("#exportPdfBtn")?.addEventListener("click", exportReportPdf);

    /* ── 6. Admin Quản lý Manager & Phê duyệt yêu cầu ──────────────────── */
    document.querySelector("#createManagerForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      setFormBusy(form, true);
      try {
        await internalApi.createManager(formPayload(form));
        internalSession.loaded.delete("accounts");
        internalSession.loaded.delete("admin-dashboard");
        notify("Đã tạo tài khoản Manager mới");
        render("accounts");
      } catch (error) {
        document.querySelector("#createManagerError").textContent = error.message;
        setFormBusy(form, false);
      }
    });

    const requestCenter = document.querySelector("#customerRequestCenter");
    requestCenter?.addEventListener("click", async event => {
      const decisionButton = event.target.closest(".request-approve, .request-reject");
      if (decisionButton) {
        const approved = decisionButton.classList.contains("request-approve");
        const isUnlock = decisionButton.dataset.action === "unlock_customer";
        const note = approved ? "" : window.prompt("Ghi chú khi từ chối yêu cầu (không bắt buộc):", "");
        if (note === null) return;
        const confirmMsg = approved
          ? (isUnlock ? "Phê duyệt yêu cầu mở khóa tài khoản khách hàng này?" : "Phê duyệt yêu cầu khóa tài khoản khách hàng này?")
          : (isUnlock ? "Từ chối yêu cầu mở khóa này?" : "Từ chối yêu cầu khóa này?");
        if (!window.confirm(confirmMsg)) return;
        decisionButton.disabled = true;
        try {
          await internalApi.decideCustomerRequest(decisionButton.dataset.id, approved ? "approved" : "rejected", note);
          internalSession.loaded.delete("customer-requests");
          internalSession.loaded.delete("admin-dashboard");
          internalSession.loaded.delete("customers");
          notify(approved
            ? (isUnlock ? "Đã phê duyệt và mở khóa tài khoản khách hàng" : "Đã phê duyệt và khóa tài khoản khách hàng")
            : "Đã từ chối yêu cầu");
          render("customer-requests");
        } catch (error) {
          notify(error.message);
          decisionButton.disabled = false;
        }
        return;
      }

      const tabButton = event.target.closest(".approval-tab");
      const pageButton = event.target.closest(".approval-page");
      if (tabButton) {
        internalSession.approvalFilters.tab = tabButton.dataset.tab;
        internalSession.approvalFilters.page = 1;
      } else if (pageButton && !pageButton.disabled) {
        internalSession.approvalFilters.page = Number(pageButton.dataset.page);
      } else {
        return;
      }
      requestCenter.querySelectorAll(".approval-tab").forEach(button => {
        const selected = button.dataset.tab === internalSession.approvalFilters.tab;
        button.classList.toggle("active", selected);
      });
      document.querySelector("#requestResults").innerHTML = customerRequestResults(
        internalSession.customerRequests,
        internalSession.approvalFilters,
        currentRole === "admin"
      );
    });

    requestCenter?.addEventListener("input", event => {
      if (!["approvalSearch", "approvalFrom", "approvalTo"].includes(event.target.id)) return;
      const filters = internalSession.approvalFilters;
      filters.query = document.querySelector("#approvalSearch").value;
      filters.from = document.querySelector("#approvalFrom").value;
      filters.to = document.querySelector("#approvalTo").value;
      filters.page = 1;
      document.querySelector("#requestResults").innerHTML = customerRequestResults(
        internalSession.customerRequests,
        filters,
        currentRole === "admin"
      );
    });
    const feedbackReplyDialog = document.querySelector("#feedbackReplyDialog");
    const feedbackReplyForm = document.querySelector("#feedbackReplyForm");
    const feedbackReplyStatus = document.querySelector("#feedbackReplyStatus");
    const feedbackReplyContent = document.querySelector("#feedbackReplyContent");
    const updateFeedbackReplyRequirement = () => {
      const requiresReply = feedbackReplyStatus?.value === "da_tiep_thu";
      if (feedbackReplyContent) feedbackReplyContent.required = requiresReply;
      const hint = document.querySelector("#feedbackReplyHint");
      if (hint) hint.textContent = requiresReply ? "Bắt buộc khi chọn Phản hồi và tiếp thu." : "Có thể để trống nếu chỉ đánh dấu đã xem.";
    };
    document.querySelectorAll(".feedback-update").forEach(button => button.addEventListener("click", () => {
      const feedback = internalSession.feedback.find(item => String(item.id) === String(button.dataset.feedbackId));
      if (!feedback) { notify("Không tìm thấy phản hồi cần xử lý"); return; }
      feedbackReplyForm.dataset.feedbackId = feedback.id;
      feedbackReplyStatus.value = "da_tiep_thu";
      feedbackReplyContent.value = feedback.reply || "";
      document.querySelector("#feedbackReplySummary").textContent = `${feedback.customerName} · ${feedback.drinkName}`;
      document.querySelector("#feedbackReplyError").textContent = "";
      updateFeedbackReplyRequirement();
      feedbackReplyDialog.showModal();
      feedbackReplyContent.focus();
    }));
    feedbackReplyStatus?.addEventListener("change", updateFeedbackReplyRequirement);
    feedbackReplyForm?.addEventListener("input", () => { document.querySelector("#feedbackReplyError").textContent = ""; });
    document.querySelector("#feedbackReplyCancel")?.addEventListener("click", () => feedbackReplyDialog.close());
    feedbackReplyDialog?.addEventListener("click", event => { if (event.target === feedbackReplyDialog) feedbackReplyDialog.close(); });
    feedbackReplyForm?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = formPayload(form);
      const button = form.querySelector("button[type='submit']");
      button.dataset.label = "Gửi phản hồi";
      setFormBusy(form, true);
      try {
        await internalApi.updateFeedback(form.dataset.feedbackId, payload.status, payload.reply);
        internalSession.loaded.delete("feedback");
        internalSession.loaded.delete("dashboard");
        feedbackReplyDialog.close();
        notify(payload.status === "da_tiep_thu" ? "Đã gửi phản hồi đến khách hàng" : "Đã đánh dấu phản hồi là đã xem");
        render("feedback");
      } catch (error) {
        document.querySelector("#feedbackReplyError").textContent = error.message;
        setFormBusy(form, false);
      }
    });
    if (view === "create-survey" || view === "edit-survey") {
      const isEdit = view === "edit-survey";
      const form = document.querySelector(isEdit ? "#editSurveyForm" : "#bulkSurveyForm");
      const recipients = document.querySelector("#surveyRecipients");
      if (recipients) {
        document.querySelectorAll("input[name='recipientMode']").forEach(input => input.addEventListener("change", () => {
          recipients.disabled = formPayload(form).recipientMode !== "selected";
        }));
      }
      document.querySelector("#addSurveyQuestion")?.addEventListener("click", () => {
        document.querySelector("#surveyQuestions").insertAdjacentHTML("beforeend", `<div class="form-grid survey-question-input"><label>Câu hỏi *<input name="question" minlength="3" required /></label><label>Các lựa chọn *<input name="choices" maxlength="5000" placeholder="Lựa chọn 1; Lựa chọn 2" required /></label><button type="button" class="outline remove-survey-question">Xóa câu hỏi</button></div>`);
      });
      document.querySelector("#surveyQuestions")?.addEventListener("click", event => {
        if (event.target.closest(".remove-survey-question")) {
          if (document.querySelectorAll(".survey-question-input").length <= 1) {
            notify("Khảo sát phải có ít nhất một câu hỏi");
            return;
          }
          event.target.closest(".survey-question-input").remove();
        }
      });
      form?.addEventListener("submit", async event => {
        event.preventDefault();
        const payload = formPayload(form);
        const questions = [...form.querySelectorAll(".survey-question-input")].map(row => ({ content: row.querySelector('[name="question"]').value.trim(), choices: row.querySelector('[name="choices"]').value.split(";").map(value => value.trim()).filter(Boolean) }));
        const deadline = payload.endAt ? new Date(payload.endAt) : null;
        const originalDeadline = isEdit && internalSession.editSurvey.endAt ? new Date(internalSession.editSurvey.endAt) : null;
        const keepsExpiredDeadline = deadline && originalDeadline && Math.floor(deadline.getTime() / 60000) === Math.floor(originalDeadline.getTime() / 60000);
        if (deadline && (!Number.isFinite(deadline.getTime()) || (deadline.getTime() <= Date.now() && !keepsExpiredDeadline))) {
          document.querySelector("#surveyError").textContent = "Hạn khảo sát phải là thời điểm trong tương lai. Vui lòng chọn lại ngày giờ.";
          return;
        }
        const recipientMode = isEdit ? null : form.querySelector("input[name='recipientMode']:checked").value;
        const customerIds = isEdit ? undefined : recipientMode === "all" ? null : [...recipients.selectedOptions].map(option => Number(option.value));
        const button = form.querySelector("button[type='submit']");
        button.dataset.label = isEdit ? "Lưu thay đổi" : "Phát hành và thông báo";
        setFormBusy(form, true);

    // Admin trực tiếp khóa/mở khóa Customer
    document.querySelectorAll(".customer-status").forEach(button => {
      button.addEventListener("click", async () => {
        const id = button.dataset.id;
        const status = button.dataset.status;
        const action = status === "locked" ? "khóa" : "mở khóa";
        if (!window.confirm(`Bạn có chắc muốn ${action} tài khoản khách hàng này?`)) return;
        try {
          await internalApi.updateCustomerStatus(id, status);
          internalSession.loaded.delete("customers");
          notify(`Đã ${action} tài khoản khách hàng`);
          render("customers");
        } catch (error) { notify(error.message); }
      });
    });

  } catch (error) {
    notify(error.message);
    if (error.status === 401 || error.status === 403) {
      internalApi.logout();
      internalSession.account = null;
      internalSession.loaded.clear();
      render("internal-login");
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════
   RENDER SHELL & APPLICATION ROUTING
   ══════════════════════════════════════════════════════════════════════ */
function render(view = "dashboard") {
  if (currentRole === "customer" && !customerApi.hasToken() && !["login", "register"].includes(view)) view = "login";
  if (currentRole !== "customer" && (!internalApi.hasToken() || !internalSession.account) && view !== "internal-login") view = "internal-login";

  const views = currentRole === "admin" ? adminViews : currentRole === "manager" ? managerViews : customerViews;
  if (!views[view]) view = currentRole === "admin" ? "admin-dashboard" : currentRole === "manager" ? "dashboard" : "customer-home";

  const renderVersion = ++navigationVersion;
  document.body.classList.toggle("auth-mode", ["internal-login", "login", "register"].includes(view));
  app.innerHTML = views[view]();
  app.classList.remove("page-enter");
  requestAnimationFrame(() => app.classList.add("page-enter"));

  const crumb = document.querySelector("#pageCrumb");
  if (crumb) crumb.textContent = titles[view] || view;

  document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.view === view));
  document.querySelector("#sidebar")?.classList.remove("open");
  window.scrollTo({ top: 0, behavior: "auto" });

  document.querySelectorAll(".action-toast").forEach(el => el.addEventListener("click", () => notify()));

  setupCustomerPage(view);
  setupInternalPage(view, renderVersion);
}

function applyRole(role) {
  currentRole = role;
  document.body.dataset.role = role;
  document.querySelector("#mainNav").innerHTML = navs[role];
  const customer = role === "customer"; const admin = role === "admin";
  document.querySelector("#userInitials").textContent = customer ? "NL" : admin ? "AD" : "NQ";
  document.querySelector("#userName").textContent = customer ? "Nguyễn Minh Long" : admin ? "System Admin" : "Nguyễn Quản Lý";
  document.querySelector("#userRole").textContent = customer ? "Khách hàng · Green" : admin ? "Quản trị viên" : "Quản lý hệ thống";
  document.querySelector("#sidebarCard").innerHTML = customer ? `<span>✦</span><strong>Khảo sát của bạn</strong><p>Đang kiểm tra các khảo sát được gửi đến tài khoản.</p><button data-view="my-surveys">Xem khảo sát →</button>` : admin ? `<span>✦</span><strong>Giám sát hệ thống</strong><p>Kiểm tra yêu cầu đang chờ và nhật ký thay đổi Customer.</p><button data-view="customer-requests">Xem yêu cầu →</button>` : `<span>✦</span><strong>Gợi ý hôm nay</strong><p>8 phản hồi mới đang chờ đội ngũ chăm sóc.</p><button data-view="feedback">Xem phản hồi →</button>`;
  document.querySelector("#globalSearch").placeholder = customer ? "Tìm trợ giúp..." : admin ? "Tìm tài khoản..." : "Tìm khách hàng...";
  const roleSelect = document.querySelector("#roleSelect");
  if (roleSelect) roleSelect.value = role;
  render(customer ? "customer-home" : admin ? "admin-dashboard" : "dashboard");
}

function logoutCurrentSession() {
  if (currentRole === "customer") {
    customerApi.logout();
    customerSession.profile = null;
    customerSession.currentSurvey = null;
    customerSession.completedSurvey = null;
    customerSession.questionIndex = 0;
    customerSession.answers = [];
    customerSession.notifications = [];
  } else {
    internalApi.logout();
    internalSession.account = null;
    internalSession.dashboard = null;
    internalSession.loaded.clear();
  }
  render(currentRole === "customer" ? "login" : "internal-login");
}

function switchRole(role) {
  if (role === currentRole) return;
  customerApi.logout();
  localStorage.removeItem("milktea-admin-token");
  localStorage.removeItem("milktea-manager-token");
  customerSession.profile = null;
  internalSession.account = null;
  internalSession.dashboard = null;
  internalSession.loaded.clear();
  const portalPorts = { admin: 4173, manager: 4174, customer: 4175 };
  const destination = new URL("/", location.origin);
  destination.port = String(portalPorts[role] || 4174);
  location.assign(destination);
}

async function initializeRole(role) {
  if (role === "customer") {
    if (customerApi.hasToken()) {
      try {
        customerSession.profile = (await customerApi.me()).profile;
      } catch (error) {
        customerApi.logout();
        if (error.status !== 401) notify(error.message);
      }
    }
    applyRole(role);
    return;
  }

  if (internalApi.hasToken()) {
    try {
      const { account } = await internalApi.me();
      if (account.role !== internalApi.portal) {
        internalApi.logout();
        notify("Phiên đăng nhập không thuộc cổng này. Vui lòng đăng nhập lại.");
      } else {
        internalSession.account = account;
        applyRole(account.role);
        return;
      }
    } catch (error) {
      internalApi.logout();
      if (error.status !== 401) notify(error.message);
    }
  }
  applyRole(role);
}

document.querySelector("#menuButton").addEventListener("click", () => document.querySelector("#sidebar").classList.toggle("open"));
document.querySelector("#roleSelect")?.addEventListener("change", e => switchRole(e.target.value));
document.querySelector(".sidebar-footer button").addEventListener("click", logoutCurrentSession);
document.querySelector(".top-actions .notification")?.addEventListener("click", () => {
  if (currentRole === "customer" && customerApi.hasToken()) render("notifications");
});
document.querySelector(".top-actions .help")?.addEventListener("click", () => {
  if (currentRole === "customer" && customerApi.hasToken()) render("help");
});
document.addEventListener("click", event => {
  const navigationButton = event.target.closest("[data-view]");
  if (!navigationButton) return;
  event.preventDefault();
  if (currentRole !== "customer" && ["surveys", "reports"].includes(navigationButton.dataset.view)) {
    internalSession.loaded.delete(navigationButton.dataset.view);
  }
  render(navigationButton.dataset.view);
});
document.addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); document.querySelector("#globalSearch").focus(); } });
document.querySelector("#globalSearch").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  if (currentRole === "customer") {
    customerSession.helpQuery = e.target.value.trim();
    render("help");
    return;
  }
  if (["admin", "manager"].includes(currentRole)) {
    render("customers");
    setTimeout(() => { const input = document.querySelector("#customerSearch"); input.value = e.target.value; input.dispatchEvent(new Event("input")); }, 0);
  }
});
document.title = APP_CONFIG.name;
initializeRole(document.body.dataset.defaultRole || APP_CONFIG.defaultRole);
