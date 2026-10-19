-- Chạy sau 01_schema.sql. Quy tắc liên bảng và các hàm nghiệp vụ.
-- p_nguoi_thuc_hien / p_khach_hang phải lấy từ phiên đăng nhập tại backend,
-- không lấy tùy ý từ body do người dùng gửi. Các hàm không thay thế xác thực API.
BEGIN;
SET TIME ZONE 'Asia/Ho_Chi_Minh';

CREATE FUNCTION fn_chuan_hoa_tai_khoan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.ten_dang_nhap := lower(btrim(NEW.ten_dang_nhap));
  NEW.ngay_cap_nhat := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_chuan_hoa_tai_khoan BEFORE INSERT OR UPDATE ON tai_khoan
FOR EACH ROW EXECUTE FUNCTION fn_chuan_hoa_tai_khoan();

CREATE FUNCTION fn_kiem_tra_khach_hang() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.nam_sinh > extract(year FROM current_date)::int THEN
    RAISE EXCEPTION 'Năm sinh không được lớn hơn năm hiện tại';
  END IF;
  NEW.ho_ten := btrim(NEW.ho_ten);
  NEW.ngay_cap_nhat := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_kiem_tra_khach_hang BEFORE INSERT OR UPDATE ON khach_hang
FOR EACH ROW EXECUTE FUNCTION fn_kiem_tra_khach_hang();

-- Kiểm tra cuối transaction: customer có đúng một hồ sơ; nội bộ không có hồ sơ KH.
-- Nhờ trì hoãn đến COMMIT, đăng ký có thể INSERT tài khoản rồi INSERT hồ sơ.
CREATE FUNCTION fn_kiem_tra_ho_so() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_ids bigint[] := '{}';
  v_id bigint;
  v_vai_tro vai_tro;
  v_co_ho_so boolean;
BEGIN
  IF TG_TABLE_NAME = 'tai_khoan' THEN
    IF TG_OP <> 'INSERT' THEN v_ids := array_append(v_ids, OLD.id); END IF;
    IF TG_OP <> 'DELETE' THEN v_ids := array_append(v_ids, NEW.id); END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN v_ids := array_append(v_ids, OLD.tai_khoan_id); END IF;
    IF TG_OP <> 'DELETE' THEN v_ids := array_append(v_ids, NEW.tai_khoan_id); END IF;
  END IF;
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT vai_tro INTO v_vai_tro FROM tai_khoan WHERE id = v_id FOR SHARE;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT EXISTS(SELECT 1 FROM khach_hang WHERE tai_khoan_id = v_id) INTO v_co_ho_so;
    IF (v_vai_tro = 'customer') <> v_co_ho_so THEN
      RAISE EXCEPTION 'Tài khoản %: vai trò customer và hồ sơ khách hàng phải khớp', v_id;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_tai_khoan_ho_so AFTER INSERT OR UPDATE OR DELETE ON tai_khoan
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_kiem_tra_ho_so();
CREATE CONSTRAINT TRIGGER trg_ho_so_tai_khoan AFTER INSERT OR UPDATE OR DELETE ON khach_hang
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_kiem_tra_ho_so();

CREATE FUNCTION crm_kiem_tra_quyen(p_tai_khoan bigint, p_vai_tro vai_tro[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_tk tai_khoan%ROWTYPE;
BEGIN
  SELECT * INTO v_tk FROM tai_khoan WHERE id = p_tai_khoan FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tài khoản không tồn tại'; END IF;
  IF v_tk.trang_thai <> 'active' THEN RAISE EXCEPTION 'Tài khoản đã bị khóa'; END IF;
  IF NOT (v_tk.vai_tro = ANY(p_vai_tro)) THEN RAISE EXCEPTION 'Không có quyền thực hiện'; END IF;
END $$;

CREATE FUNCTION fn_kiem_tra_phan_hoi() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM crm_kiem_tra_quyen(NEW.khach_hang_id, ARRAY['customer']::vai_tro[]);
  ELSE
    IF ROW(NEW.khach_hang_id,NEW.do_uong_id,NEW.so_sao,NEW.noi_dung,NEW.ngay_gui)
       IS DISTINCT FROM ROW(OLD.khach_hang_id,OLD.do_uong_id,OLD.so_sao,OLD.noi_dung,OLD.ngay_gui) THEN
      RAISE EXCEPTION 'Không sửa nội dung phản hồi đã gửi';
    END IF;
  END IF;
  IF NEW.nguoi_xu_ly_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tai_khoan WHERE id = NEW.nguoi_xu_ly_id AND vai_tro IN ('admin','manager','staff')
  ) THEN RAISE EXCEPTION 'Người xử lý phải là tài khoản nội bộ'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_phan_hoi BEFORE INSERT OR UPDATE ON phan_hoi
FOR EACH ROW EXECUTE FUNCTION fn_kiem_tra_phan_hoi();

CREATE FUNCTION fn_bao_ve_khao_sat() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.trang_thai <> 'nhap' THEN RAISE EXCEPTION 'Khảo sát mới phải ở trạng thái nháp'; END IF;
  ELSE
    IF OLD.trang_thai <> 'nhap' AND ROW(NEW.id,NEW.nguoi_tao_id,NEW.ngay_phat_hanh)
       IS DISTINCT FROM ROW(OLD.id,OLD.nguoi_tao_id,OLD.ngay_phat_hanh) THEN
      RAISE EXCEPTION 'Không thể thay đổi thông tin định danh hoặc ngày phát hành';
    END IF;
    IF NEW.trang_thai <> OLD.trang_thai AND NOT (
      (OLD.trang_thai = 'nhap' AND NEW.trang_thai = 'dang_mo') OR
      (OLD.trang_thai = 'dang_mo' AND NEW.trang_thai = 'da_dong')
    ) THEN RAISE EXCEPTION 'Chuyển trạng thái khảo sát không hợp lệ'; END IF;
    IF OLD.trang_thai = 'nhap' AND NEW.trang_thai = 'dang_mo' THEN
      IF NOT EXISTS(SELECT 1 FROM cau_hoi WHERE khao_sat_id = NEW.id) THEN
        RAISE EXCEPTION 'Khảo sát cần ít nhất một câu hỏi';
      END IF;
      IF EXISTS(SELECT 1 FROM cau_hoi c LEFT JOIN lua_chon l ON l.cau_hoi_id = c.id
        WHERE c.khao_sat_id = NEW.id GROUP BY c.id HAVING count(l.id) < 2) THEN
        RAISE EXCEPTION 'Mỗi câu hỏi cần ít nhất hai lựa chọn';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.nguoi_tao_id IS DISTINCT FROM OLD.nguoi_tao_id THEN
    IF NOT EXISTS(SELECT 1 FROM tai_khoan WHERE id = NEW.nguoi_tao_id AND vai_tro IN ('admin','manager')) THEN
      RAISE EXCEPTION 'Người tạo khảo sát phải là admin hoặc manager';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_bao_ve_khao_sat BEFORE INSERT OR UPDATE ON khao_sat
FOR EACH ROW EXECUTE FUNCTION fn_bao_ve_khao_sat();

-- Khóa hàng khảo sát để sửa cấu trúc và phát hành không chạy xen kẽ.
CREATE FUNCTION fn_bao_ve_cau_hoi() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_trang_thai trang_thai_khao_sat;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id <> OLD.id OR NEW.khao_sat_id <> OLD.khao_sat_id) THEN
    RAISE EXCEPTION 'Không đổi ID hoặc chuyển câu hỏi sang khảo sát khác';
  END IF;
  IF TG_OP = 'DELETE' THEN v_id := OLD.khao_sat_id; ELSE v_id := NEW.khao_sat_id; END IF;
  SELECT trang_thai INTO v_trang_thai FROM khao_sat WHERE id = v_id FOR UPDATE;
  IF v_trang_thai <> 'nhap' AND EXISTS (
    SELECT 1 FROM phan_phoi_khao_sat
     WHERE khao_sat_id = v_id AND ngay_hoan_thanh IS NOT NULL
  ) THEN RAISE EXCEPTION 'Không thể sửa câu hỏi sau khi đã có phản hồi hoàn thành'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_bao_ve_cau_hoi BEFORE INSERT OR UPDATE OR DELETE ON cau_hoi
FOR EACH ROW EXECUTE FUNCTION fn_bao_ve_cau_hoi();

CREATE FUNCTION fn_bao_ve_lua_chon() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_cau_hoi bigint; v_trang_thai trang_thai_khao_sat;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id <> OLD.id OR NEW.cau_hoi_id <> OLD.cau_hoi_id) THEN
    RAISE EXCEPTION 'Không đổi ID hoặc chuyển lựa chọn sang câu hỏi khác';
  END IF;
  IF TG_OP = 'DELETE' THEN v_cau_hoi := OLD.cau_hoi_id; ELSE v_cau_hoi := NEW.cau_hoi_id; END IF;
  SELECT k.trang_thai INTO v_trang_thai FROM khao_sat k
    JOIN cau_hoi c ON c.khao_sat_id = k.id WHERE c.id = v_cau_hoi FOR UPDATE OF k;
  IF v_trang_thai <> 'nhap' AND EXISTS (
    SELECT 1 FROM cau_hoi c JOIN phan_phoi_khao_sat p ON p.khao_sat_id = c.khao_sat_id
     WHERE c.id = v_cau_hoi AND p.ngay_hoan_thanh IS NOT NULL
  ) THEN RAISE EXCEPTION 'Không thể sửa lựa chọn sau khi đã có phản hồi hoàn thành'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_bao_ve_lua_chon BEFORE INSERT OR UPDATE OR DELETE ON lua_chon
FOR EACH ROW EXECUTE FUNCTION fn_bao_ve_lua_chon();

-- NULL danh sách: gửi toàn bộ khách active tại thời điểm phát hành.
-- Danh sách cụ thể: mọi ID phải là khách active; trùng ID trong input được loại bỏ.
CREATE FUNCTION crm_phat_hanh_khao_sat(p_nguoi_thuc_hien bigint, p_khao_sat bigint, p_khach_hang bigint[] DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_ks khao_sat%ROWTYPE; v_so_luong int;
BEGIN
  PERFORM crm_kiem_tra_quyen(p_nguoi_thuc_hien, ARRAY['admin','manager']::vai_tro[]);
  SELECT * INTO v_ks FROM khao_sat WHERE id = p_khao_sat FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Khảo sát không tồn tại'; END IF;
  IF v_ks.trang_thai <> 'nhap' THEN RAISE EXCEPTION 'Khảo sát đã phát hành'; END IF;
  IF v_ks.ngay_ket_thuc IS NOT NULL AND v_ks.ngay_ket_thuc <= clock_timestamp() THEN
    RAISE EXCEPTION 'Thời hạn khảo sát đã qua';
  END IF;
  IF p_khach_hang IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(p_khach_hang) x(id)
    WHERE NOT EXISTS(SELECT 1 FROM khach_hang h JOIN tai_khoan t ON t.id = h.tai_khoan_id
      WHERE h.tai_khoan_id = x.id AND t.trang_thai = 'active')
  ) THEN RAISE EXCEPTION 'Danh sách có khách hàng không tồn tại hoặc bị khóa'; END IF;
  UPDATE khao_sat SET trang_thai = 'dang_mo', ngay_phat_hanh = clock_timestamp() WHERE id = p_khao_sat;
  INSERT INTO phan_phoi_khao_sat(khao_sat_id,khach_hang_id,ngay_gui)
    SELECT p_khao_sat,h.tai_khoan_id,clock_timestamp()
    FROM khach_hang h JOIN tai_khoan t ON t.id = h.tai_khoan_id
    WHERE t.trang_thai = 'active' AND (p_khach_hang IS NULL OR h.tai_khoan_id = ANY(p_khach_hang));
  GET DIAGNOSTICS v_so_luong = ROW_COUNT;
  IF v_so_luong = 0 THEN RAISE EXCEPTION 'Không có người nhận; chưa phát hành khảo sát'; END IF;
  RETURN v_so_luong;
END $$;

-- Không lưu bài nháp. Mọi câu trả lời và trạng thái hoàn thành được ghi nguyên tử.
CREATE FUNCTION crm_nop_khao_sat(p_khach_hang bigint, p_khao_sat bigint, p_cau_tra_loi jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ks khao_sat%ROWTYPE; v_da_nop timestamptz;
BEGIN
  PERFORM crm_kiem_tra_quyen(p_khach_hang, ARRAY['customer']::vai_tro[]);
  SELECT * INTO v_ks FROM khao_sat WHERE id = p_khao_sat FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Khảo sát không tồn tại'; END IF;
  IF v_ks.da_an OR v_ks.trang_thai <> 'dang_mo' OR (v_ks.ngay_ket_thuc IS NOT NULL AND v_ks.ngay_ket_thuc <= clock_timestamp()) THEN
    RAISE EXCEPTION 'Khảo sát đã đóng hoặc hết hạn';
  END IF;
  SELECT ngay_hoan_thanh INTO v_da_nop FROM phan_phoi_khao_sat
    WHERE khao_sat_id = p_khao_sat AND khach_hang_id = p_khach_hang FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Khách hàng chưa được nhận khảo sát này'; END IF;
  IF v_da_nop IS NOT NULL THEN RAISE EXCEPTION 'Khảo sát đã hoàn thành; không được nộp lần hai'; END IF;
  IF p_cau_tra_loi IS NULL OR jsonb_typeof(p_cau_tra_loi) <> 'array' THEN
    RAISE EXCEPTION 'Câu trả lời phải là một mảng JSON';
  END IF;
  INSERT INTO cau_tra_loi(khao_sat_id,khach_hang_id,cau_hoi_id,lua_chon_id)
    SELECT p_khao_sat,p_khach_hang,x.cau_hoi_id,x.lua_chon_id
    FROM jsonb_to_recordset(p_cau_tra_loi) AS x(cau_hoi_id bigint,lua_chon_id bigint);
  -- FK ghép kiểm tra câu hỏi đúng khảo sát và lựa chọn đúng câu hỏi.
  -- PK ghép chặn lặp câu hỏi trong cùng bài.
  IF EXISTS(SELECT 1 FROM cau_hoi c WHERE c.khao_sat_id = p_khao_sat AND c.bat_buoc
    AND NOT EXISTS(SELECT 1 FROM cau_tra_loi a WHERE a.khao_sat_id = p_khao_sat
      AND a.khach_hang_id = p_khach_hang AND a.cau_hoi_id = c.id)) THEN
    RAISE EXCEPTION 'Chưa trả lời đủ các câu hỏi bắt buộc';
  END IF;
  UPDATE phan_phoi_khao_sat SET ngay_hoan_thanh = clock_timestamp()
    WHERE khao_sat_id = p_khao_sat AND khach_hang_id = p_khach_hang;
END $$;

CREATE FUNCTION crm_dong_khao_sat(p_nguoi_thuc_hien bigint, p_khao_sat bigint)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM crm_kiem_tra_quyen(p_nguoi_thuc_hien, ARRAY['admin','manager']::vai_tro[]);
  UPDATE khao_sat SET trang_thai = 'da_dong' WHERE id = p_khao_sat AND trang_thai = 'dang_mo';
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy khảo sát đang mở'; END IF;
END $$;

CREATE FUNCTION crm_xu_ly_phan_hoi(p_nguoi_thuc_hien bigint, p_phan_hoi bigint, p_trang_thai trang_thai_phan_hoi)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM crm_kiem_tra_quyen(p_nguoi_thuc_hien, ARRAY['admin','manager','staff']::vai_tro[]);
  IF p_trang_thai IS NULL OR p_trang_thai = 'moi' THEN RAISE EXCEPTION 'Chọn đã xem hoặc đã tiếp thu'; END IF;
  UPDATE phan_hoi SET trang_thai = p_trang_thai, nguoi_xu_ly_id = p_nguoi_thuc_hien, ngay_xu_ly = clock_timestamp()
    WHERE id = p_phan_hoi;
  IF NOT FOUND THEN RAISE EXCEPTION 'Phản hồi không tồn tại'; END IF;
END $$;

CREATE FUNCTION crm_dat_trang_thai_khach_hang(p_nguoi_thuc_hien bigint, p_khach_hang bigint, p_trang_thai trang_thai_tai_khoan)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM crm_kiem_tra_quyen(p_nguoi_thuc_hien, ARRAY['admin','manager']::vai_tro[]);
  UPDATE tai_khoan SET trang_thai = p_trang_thai WHERE id = p_khach_hang AND vai_tro = 'customer';
  IF NOT FOUND THEN RAISE EXCEPTION 'Khách hàng không tồn tại'; END IF;
END $$;

-- Bảo vệ bài đã nộp, kể cả khi lập trình viên ghi trực tiếp vào bảng.
CREATE FUNCTION fn_bao_ve_cau_tra_loi() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_ks bigint; v_kh bigint; v_da_nop timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(NEW.khao_sat_id,NEW.khach_hang_id,NEW.cau_hoi_id)
    IS DISTINCT FROM ROW(OLD.khao_sat_id,OLD.khach_hang_id,OLD.cau_hoi_id) THEN
    RAISE EXCEPTION 'Không đổi khóa của câu trả lời';
  END IF;
  IF TG_OP = 'DELETE' THEN v_ks:=OLD.khao_sat_id; v_kh:=OLD.khach_hang_id;
  ELSE v_ks:=NEW.khao_sat_id; v_kh:=NEW.khach_hang_id; END IF;
  SELECT ngay_hoan_thanh INTO v_da_nop FROM phan_phoi_khao_sat
    WHERE khao_sat_id=v_ks AND khach_hang_id=v_kh FOR UPDATE;
  -- Khi xóa khách hàng, hàng phân phối đã bị xóa trước khi CASCADE tới câu trả lời.
  IF FOUND AND v_da_nop IS NOT NULL THEN RAISE EXCEPTION 'Không sửa hoặc xóa câu trả lời đã nộp'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_bao_ve_cau_tra_loi BEFORE INSERT OR UPDATE OR DELETE ON cau_tra_loi
FOR EACH ROW EXECUTE FUNCTION fn_bao_ve_cau_tra_loi();

CREATE FUNCTION fn_bao_ve_phan_phoi() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_ks khao_sat%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.khao_sat_id,NEW.khach_hang_id,NEW.ngay_gui)
       IS DISTINCT FROM ROW(OLD.khao_sat_id,OLD.khach_hang_id,OLD.ngay_gui) THEN
      RAISE EXCEPTION 'Không thay đổi người nhận hoặc ngày gửi';
    END IF;
    IF OLD.ngay_hoan_thanh IS NOT NULL AND NEW.ngay_hoan_thanh IS DISTINCT FROM OLD.ngay_hoan_thanh THEN
      RAISE EXCEPTION 'Không thay đổi trạng thái bài đã nộp';
    END IF;
  END IF;
  IF TG_OP='INSERT' OR (NEW.ngay_hoan_thanh IS NOT NULL AND OLD.ngay_hoan_thanh IS NULL) THEN
    PERFORM crm_kiem_tra_quyen(NEW.khach_hang_id,ARRAY['customer']::vai_tro[]);
    SELECT * INTO v_ks FROM khao_sat WHERE id=NEW.khao_sat_id FOR UPDATE;
    IF v_ks.da_an OR v_ks.trang_thai <> 'dang_mo' OR (v_ks.ngay_ket_thuc IS NOT NULL AND v_ks.ngay_ket_thuc<=clock_timestamp()) THEN
      RAISE EXCEPTION 'Khảo sát không còn mở';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_bao_ve_phan_phoi BEFORE INSERT OR UPDATE ON phan_phoi_khao_sat
FOR EACH ROW EXECUTE FUNCTION fn_bao_ve_phan_phoi();

-- Cuối transaction: bài chưa nộp không được có câu trả lời; bài đã nộp đủ câu bắt buộc.
CREATE FUNCTION fn_kiem_tra_bai_lam() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_ks bigint; v_kh bigint; v_da_nop timestamptz;
BEGIN
  IF TG_OP='DELETE' THEN v_ks:=OLD.khao_sat_id; v_kh:=OLD.khach_hang_id;
  ELSE v_ks:=NEW.khao_sat_id; v_kh:=NEW.khach_hang_id; END IF;
  SELECT ngay_hoan_thanh INTO v_da_nop FROM phan_phoi_khao_sat
    WHERE khao_sat_id=v_ks AND khach_hang_id=v_kh;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_da_nop IS NULL THEN
    IF EXISTS(SELECT 1 FROM cau_tra_loi WHERE khao_sat_id=v_ks AND khach_hang_id=v_kh) THEN
      RAISE EXCEPTION 'Phải nộp toàn bộ bài trong cùng transaction, không lưu nháp';
    END IF;
  ELSIF EXISTS(SELECT 1 FROM cau_hoi c WHERE c.khao_sat_id=v_ks AND c.bat_buoc
    AND NOT EXISTS(SELECT 1 FROM cau_tra_loi a WHERE a.khao_sat_id=v_ks AND a.khach_hang_id=v_kh AND a.cau_hoi_id=c.id)) THEN
    RAISE EXCEPTION 'Bài đã nộp còn thiếu câu hỏi bắt buộc';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_cau_tra_loi_day_du AFTER INSERT OR UPDATE OR DELETE ON cau_tra_loi
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_kiem_tra_bai_lam();
CREATE CONSTRAINT TRIGGER trg_phan_phoi_day_du AFTER INSERT OR UPDATE OR DELETE ON phan_phoi_khao_sat
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_kiem_tra_bai_lam();

COMMIT;
