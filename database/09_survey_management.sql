-- Cho phép ẩn/khôi phục khảo sát và sửa nội dung trước khi có phản hồi hoàn thành.
BEGIN;

ALTER TABLE khao_sat ADD COLUMN IF NOT EXISTS da_an boolean NOT NULL DEFAULT false;
COMMENT ON TABLE khao_sat IS 'Luồng trạng thái: nhap -> dang_mo -> da_dong. Hết hạn và ẩn đều chặn nộp. Câu hỏi/lựa chọn có thể sửa trước khi phát sinh phản hồi hoàn thành.';

CREATE OR REPLACE FUNCTION fn_bao_ve_khao_sat() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE OR REPLACE FUNCTION fn_bao_ve_cau_hoi() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE OR REPLACE FUNCTION fn_bao_ve_lua_chon() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE OR REPLACE FUNCTION fn_bao_ve_phan_phoi() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE OR REPLACE FUNCTION crm_nop_khao_sat(p_khach_hang bigint, p_khao_sat bigint, p_cau_tra_loi jsonb)
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
  IF EXISTS(SELECT 1 FROM cau_hoi c WHERE c.khao_sat_id = p_khao_sat AND c.bat_buoc
    AND NOT EXISTS(SELECT 1 FROM cau_tra_loi a WHERE a.khao_sat_id = p_khao_sat
      AND a.khach_hang_id = p_khach_hang AND a.cau_hoi_id = c.id)) THEN
    RAISE EXCEPTION 'Chưa trả lời đủ các câu hỏi bắt buộc';
  END IF;
  UPDATE phan_phoi_khao_sat SET ngay_hoan_thanh = clock_timestamp()
    WHERE khao_sat_id = p_khao_sat AND khach_hang_id = p_khach_hang;
END $$;

COMMIT;
