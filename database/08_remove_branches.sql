-- Chuyển database hiện có sang schema không dùng chi nhánh.
-- Giữ nguyên tài khoản, khách hàng và nội dung phản hồi.
BEGIN;

CREATE OR REPLACE FUNCTION fn_kiem_tra_phan_hoi() RETURNS trigger LANGUAGE plpgsql AS $$
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

ALTER TABLE tai_khoan DROP COLUMN IF EXISTS chi_nhanh_id;
ALTER TABLE phan_hoi DROP COLUMN IF EXISTS chi_nhanh_id;
DROP TABLE IF EXISTS chi_nhanh;

COMMIT;
