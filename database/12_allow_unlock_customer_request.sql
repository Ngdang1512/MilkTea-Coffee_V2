-- Migration 12: Thêm hỗ trợ đề xuất mở khóa khách hàng (unlock_customer) cho Manager và Admin
BEGIN;

ALTER TABLE yeu_cau_admin_khach_hang
  DROP CONSTRAINT IF EXISTS ck_yeu_cau_loai;

ALTER TABLE yeu_cau_admin_khach_hang
  ADD CONSTRAINT ck_yeu_cau_loai CHECK (loai IN ('lock_customer', 'unlock_customer', 'delete_customer'));

COMMIT;
