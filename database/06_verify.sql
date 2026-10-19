-- Chạy trên dữ liệu demo nguyên trạng sau 01..04.
-- Kiểm tra bằng dữ liệu thật, ROLLBACK toàn bộ thay đổi khi xong.
BEGIN;
CREATE TEMP TABLE crm_test_results(thu_tu int GENERATED ALWAYS AS IDENTITY,ket_qua text,kiem_tra text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.assert_true(p_dung boolean,p_ten text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_dung IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',p_ten; END IF;
  INSERT INTO crm_test_results(ket_qua,kiem_tra) VALUES ('PASS',p_ten);
END $$;
CREATE FUNCTION pg_temp.expect_error(p_sql text,p_doan_loi text,p_ten text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_co_loi boolean:=false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_doan_loi IN SQLERRM)=0 THEN
      RAISE EXCEPTION 'FAIL %: lỗi không mong đợi: %',p_ten,SQLERRM;
    END IF;
    v_co_loi:=true;
  END;
  PERFORM pg_temp.assert_true(v_co_loi,p_ten);
END $$;

SELECT pg_temp.assert_true((
  SELECT count(*) = 10 + (to_regclass('public.thong_bao') IS NOT NULL)::int
  FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'
),'Đủ bảng CRM và thông báo nếu đã bật');
SELECT pg_temp.assert_true((SELECT count(*)=8 FROM khach_hang),'Đủ 8 khách hàng demo');
SELECT pg_temp.assert_true((SELECT count(*)=12 FROM cau_tra_loi),'Đủ 12 câu trả lời demo');
SELECT pg_temp.assert_true((SELECT array_agg(so_khach_hang ORDER BY thu_tu)=ARRAY[1,3,3,1]::bigint[] FROM v_bao_cao_do_tuoi),'Phân nhóm tuổi đúng ranh giới 18,24,35');
SELECT pg_temp.assert_true((SELECT bool_and(so_khach_hang=2 AND ty_le_phan_tram=25) FROM v_bao_cao_so_thich),'Tỷ lệ sở thích đúng mẫu số');
SELECT pg_temp.assert_true((SELECT so_nguoi_duoc_gui=7 AND so_nguoi_da_lam=4 AND ty_le_hoan_thanh=57.14 FROM v_tien_do_khao_sat WHERE khao_sat_id=1),'Tiến độ 4/7 = 57,14%');
SELECT pg_temp.assert_true((SELECT ty_le_hoan_thanh=66.67 FROM v_tien_do_khao_sat WHERE khao_sat_id=2),'Tiến độ 2/3 = 66,67%');
SELECT pg_temp.assert_true((SELECT array_agg(ty_le_phan_tram ORDER BY lua_chon_id)=ARRAY[50,25,25]::numeric[] FROM v_ket_qua_khao_sat WHERE cau_hoi_id=2),'Biểu đồ đáp án 50%/25%/25%');
SELECT pg_temp.assert_true((SELECT so_luot_chon=0 AND ty_le_phan_tram=0 FROM v_ket_qua_khao_sat WHERE lua_chon_id=9),'Đáp án không được chọn vẫn xuất hiện');
SELECT pg_temp.assert_true((SELECT ty_le_hoan_thanh IS NULL FROM v_tien_do_khao_sat WHERE khao_sat_id=3),'Mẫu số bằng 0 trả về NULL');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM phan_hoi WHERE khach_hang_id=11),'Khóa tài khoản giữ phản hồi');

SELECT pg_temp.expect_error($q$INSERT INTO tai_khoan(id,ten_dang_nhap,mat_khau_hash,vai_tro) SELECT 900,' ADMIN ',mat_khau_hash,'admin' FROM tai_khoan WHERE id=1$q$,'unique constraint','Username không phân biệt hoa/thường');
SELECT pg_temp.expect_error($q$INSERT INTO tai_khoan(id,ten_dang_nhap,mat_khau_hash) SELECT 900,'orphan',mat_khau_hash FROM tai_khoan WHERE id=1$q$,'hồ sơ khách hàng phải khớp','Không cho customer thiếu hồ sơ tại COMMIT');
SELECT pg_temp.expect_error($q$INSERT INTO khach_hang(tai_khoan_id,ma_thanh_vien,ho_ten,nam_sinh,so_thich_id) VALUES(1,'TVADMIN','Admin',2000,1)$q$,'hồ sơ khách hàng phải khớp','Không gắn hồ sơ khách hàng vào admin');
SELECT pg_temp.expect_error($q$UPDATE khach_hang SET nam_sinh=extract(year FROM current_date)::int+1 WHERE tai_khoan_id=8$q$,'Năm sinh','Không nhận năm sinh tương lai');
SELECT pg_temp.expect_error($q$INSERT INTO phan_hoi(id,khach_hang_id,do_uong_id,so_sao,noi_dung) VALUES(900,8,1,6,'Sai số sao')$q$,'ck_phan_hoi_so_sao','Chặn đánh giá ngoài 1–5 sao');
SELECT pg_temp.expect_error($q$INSERT INTO phan_phoi_khao_sat(khao_sat_id,khach_hang_id) VALUES(1,8)$q$,'unique constraint','Không phân phối trùng');
SELECT pg_temp.expect_error($q$INSERT INTO cau_tra_loi VALUES(1,8,3,7)$q$,'foreign key constraint','Câu hỏi phải thuộc đúng khảo sát');
SELECT pg_temp.expect_error($q$INSERT INTO cau_tra_loi VALUES(1,8,1,5)$q$,'foreign key constraint','Đáp án phải thuộc đúng câu hỏi');
SELECT pg_temp.expect_error($q$INSERT INTO cau_tra_loi VALUES(2,9,3,7)$q$,'foreign key constraint','Người trả lời phải có phân phối');
SELECT pg_temp.expect_error($q$SELECT crm_nop_khao_sat(8,1,'[{"cau_hoi_id":1,"lua_chon_id":1}]')$q$,'Chưa trả lời đủ','Chặn nộp thiếu câu bắt buộc');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM cau_tra_loi WHERE khao_sat_id=1 AND khach_hang_id=8),'Nộp lỗi không lưu dở câu trả lời');
SELECT pg_temp.expect_error($q$SELECT crm_nop_khao_sat(4,1,'[]')$q$,'không được nộp lần hai','Chặn nộp lần hai');
SELECT pg_temp.expect_error($q$SELECT crm_nop_khao_sat(11,1,'[]')$q$,'bị khóa','Khách bị khóa không nộp được');
SELECT pg_temp.expect_error($q$SELECT crm_nop_khao_sat(8,2,'[]')$q$,'đã đóng hoặc hết hạn','Chặn bài nộp vào khảo sát đóng');
SELECT pg_temp.expect_error($q$UPDATE cau_tra_loi SET lua_chon_id=2 WHERE khao_sat_id=1 AND khach_hang_id=4 AND cau_hoi_id=1$q$,'Không sửa hoặc xóa','Không sửa câu trả lời đã nộp');
SELECT pg_temp.expect_error($q$UPDATE phan_phoi_khao_sat SET ngay_hoan_thanh=clock_timestamp() WHERE khao_sat_id=1 AND khach_hang_id=8$q$,'thiếu câu hỏi bắt buộc','Ghi trực tiếp không được đánh dấu hoàn thành bài thiếu');
SELECT pg_temp.expect_error($q$INSERT INTO cau_tra_loi VALUES(1,8,1,1)$q$,'không lưu nháp','Chặn lưu dở một câu trả lời qua transaction');
SELECT pg_temp.expect_error($q$UPDATE cau_hoi SET noi_dung='Đổi nội dung' WHERE id=1$q$,'còn nháp','Khóa cấu trúc khảo sát sau phát hành');
SELECT pg_temp.expect_error($q$UPDATE lua_chon SET noi_dung='Đổi đáp án' WHERE id=4$q$,'còn nháp','Khóa lựa chọn sau phát hành');
SELECT pg_temp.expect_error($q$SELECT crm_phat_hanh_khao_sat(2,3,ARRAY[]::bigint[])$q$,'Không có người nhận','Không phát hành đến nhóm rỗng');
SELECT pg_temp.assert_true((SELECT trang_thai='nhap' FROM khao_sat WHERE id=3),'Phát hành lỗi trả khảo sát về nháp');
SELECT pg_temp.expect_error($q$SELECT crm_phat_hanh_khao_sat(2,3,ARRAY[11]::bigint[])$q$,'bị khóa','Không gửi mới đến tài khoản bị khóa');
SELECT pg_temp.expect_error($q$DELETE FROM lua_chon WHERE cau_hoi_id=5 AND id<>13; SELECT crm_phat_hanh_khao_sat(2,3,ARRAY[8]::bigint[])$q$,'ít nhất hai lựa chọn','Không phát hành câu hỏi thiếu lựa chọn');
SELECT pg_temp.expect_error($q$DELETE FROM do_uong WHERE id=1$q$,'foreign key constraint','Không xóa món đang có lịch sử phản hồi');

SELECT crm_dat_trang_thai_khach_hang(2,6,'locked');
SELECT pg_temp.assert_true((SELECT count(*)=4 FROM cau_tra_loi WHERE khach_hang_id=6),'Khóa giữ nguyên câu trả lời khảo sát');
SELECT crm_dat_trang_thai_khach_hang(2,6,'active');

SELECT crm_phat_hanh_khao_sat(2,3,ARRAY[8,9,9]::bigint[]);
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM phan_phoi_khao_sat WHERE khao_sat_id=3),'Loại bỏ ID người nhận lặp trong input');
SELECT crm_nop_khao_sat(8,3,'[{"cau_hoi_id":5,"lua_chon_id":13}]');
SELECT pg_temp.assert_true((SELECT ngay_hoan_thanh IS NOT NULL FROM phan_phoi_khao_sat WHERE khao_sat_id=3 AND khach_hang_id=8),'Cho phép bỏ qua câu không bắt buộc');
SELECT pg_temp.expect_error($q$SELECT crm_nop_khao_sat(9,3,'[{"cau_hoi_id":5,"lua_chon_id":13},{"cau_hoi_id":5,"lua_chon_id":14}]')$q$,'unique constraint','Một câu hỏi chỉ chọn một đáp án');
SELECT pg_temp.expect_error($q$SELECT crm_nop_khao_sat(10,3,'[]')$q$,'chưa được nhận','Hàm nộp chặn khách ngoài danh sách');

UPDATE tai_khoan SET vai_tro='staff' WHERE id=2;
SELECT crm_dong_khao_sat(1,1);
SELECT pg_temp.assert_true((SELECT trang_thai='da_dong' FROM khao_sat WHERE id=1),'Admin vẫn quản lý được khảo sát khi người tạo đã đổi vai trò');

SELECT * FROM crm_test_results ORDER BY thu_tu;
ROLLBACK;
