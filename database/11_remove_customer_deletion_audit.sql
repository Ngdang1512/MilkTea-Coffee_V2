-- Disable legacy customer deletion requests while retaining their history.
-- Customer audit records are left in place as archived data; the API no longer reads or writes them.
BEGIN;

UPDATE yeu_cau_admin_khach_hang
   SET trang_thai = 'rejected',
       ghi_chu_quyet_dinh = concat_ws(
         E'\n',
         NULLIF(trim(ghi_chu_quyet_dinh), ''),
         'Yêu cầu đã bị hủy vì chức năng xóa khách hàng đã được gỡ.'
       ),
       ngay_quyet_dinh = COALESCE(ngay_quyet_dinh, clock_timestamp())
 WHERE loai = 'delete_customer'
   AND trang_thai = 'pending';

DROP FUNCTION IF EXISTS crm_xoa_khach_hang(bigint, bigint);

COMMIT;
