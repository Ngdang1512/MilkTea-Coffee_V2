-- DỮ LIỆU GIẢ LẬP. Chạy một lần trên schema mới, sau 01 và 02.
-- Tất cả tài khoản demo dùng mật khẩu: DemoCRM@2026
-- Chuỗi hash scrypt: scrypt$N$r$p$salt_base64$derived_key_base64.
BEGIN;
SET TIME ZONE 'Asia/Ho_Chi_Minh';
INSERT INTO nhom_so_thich(id,ten_nhom,mo_ta) VALUES
(1,'Trà sữa truyền thống','Thích vị trà sữa và topping'),
(2,'Cà phê muối','Thích cà phê kết hợp kem muối'),
(3,'Trà trái cây nhiệt đới','Thích trà kết hợp trái cây'),
(4,'Đồ uống ít ngọt/Healthy','Ưu tiên ít đường');
INSERT INTO tai_khoan(id,ten_dang_nhap,mat_khau_hash,vai_tro,nguoi_tao_id) VALUES
(1,'admin','$2y$12$VsyfPgYPc4XVV.H4/m1r1Oyuimvnci4FrLQsugd5cy6.Db.mTca0a','admin',NULL),
(2,'quanly','$2y$12$P0y6NM.TRst4vabfMLlrwe4mIVFAQusAaeaF33rr6ioHZaxjBcX2S','manager',1),
(3,'nhanvien','$2y$12$EH65izSCtPB14S76rzQFDeEZICk4yU3zKloXjySWEgj6Yvhj/6k1O','staff',1),
(4,'khach01','$2y$12$sKDwdi6bXt.SSX3SaRJAVeRdUNqoYN8XrEnnDeTGvP0QnJMnheB.G','customer',3),
(5,'khach02','$2y$12$fi8oVXK5lAAtSdSsCHSYq.Z0CkrilSJbEaAwl72xGHIkPzAWwXTx6','customer',3),
(6,'khach03','$2y$12$zkWRL8l4BbKmbtoX/nr.suPrBcfpWePnMqEwxwNguawix9MI95Oza','customer',NULL),
(7,'khach04','$2y$12$/Z0aYQpAL965cZSKg01foumSsWtwb2Q6ctoOs33x6360ycSOPKt6y','customer',NULL),
(8,'khach05','$2y$12$QCDOVO/Hfqy8s8EAcpKW8OxWbNgWGRPIQE0UcQKfZ72q.mkYTUrty','customer',NULL),
(9,'khach06','$2y$12$fpvhdrqFyM1WkdBa05tkve/VVj0cWSVPdzWRRGe40SD15cUETBBRm','customer',NULL),
(10,'khach07','$2y$12$iSpWzWh9Rpb/eFRvDnVlEeQl/A5UW8WqHrhnlmXF8ThKQyY.8hW82','customer',NULL),
(11,'khach08','$2y$12$aa.S53EU1ClFG5oXTbAxauLVRWJbH8SYXGyGsxR2KXzp2dlF2k70S','customer',NULL);
INSERT INTO khach_hang(tai_khoan_id,ma_thanh_vien,ho_ten,nam_sinh,gioi_tinh,so_thich_id) VALUES
(4,'TV0004','Nguyễn Minh An',extract(year FROM current_date)::int-17,'nam',1),
(5,'TV0005','Trần Bảo Ngọc',extract(year FROM current_date)::int-20,'nu',1),
(6,'TV0006','Lê Hoàng Nam',extract(year FROM current_date)::int-24,'nam',2),
(7,'TV0007','Phạm Khánh Linh',extract(year FROM current_date)::int-28,'nu',3),
(8,'TV0008','Lê Gia Hân',extract(year FROM current_date)::int-35,'nu',4),
(9,'TV0009','Đỗ Quốc Bảo',extract(year FROM current_date)::int-42,'nam',2),
(10,'TV0010','Bùi Thanh Vy',extract(year FROM current_date)::int-18,'nu',3),
(11,'TV0011','Võ Đức Anh',extract(year FROM current_date)::int-31,'nam',4);
INSERT INTO do_uong(id,ma_do_uong,ten_do_uong,mo_ta,dang_kinh_doanh) VALUES
(1,'TS01','Trà sữa Oolong nướng','Trà Oolong, sữa và trân châu',true),
(2,'CP01','Cà phê muối','Cà phê cùng lớp kem muối',true),
(3,'TT01','Trà đào cam sả','Trà trái cây',true),
(4,'CB01','Cold Brew cam sả','Sản phẩm thử nghiệm',true),
(5,'HL01','Trà sen ít đường','Lựa chọn ít ngọt',true),
(6,'TS02','Trà sữa khoai môn','Đã ngừng kinh doanh, vẫn giữ lịch sử',false);
INSERT INTO phan_hoi(id,khach_hang_id,do_uong_id,so_sao,noi_dung,ngay_gui) VALUES
(1,4,1,4,'Trân châu mềm, trà hơi ngọt.',now()-interval '7 days'),
(2,5,1,5,'Mùi trà thơm, nhân viên tư vấn tốt.',now()-interval '6 days'),
(3,6,2,4,'Kem muối ngon, muốn vị cà phê đậm hơn.',now()-interval '5 days'),
(4,7,3,5,'Vị trái cây tươi, ít đá sẽ ngon hơn.',now()-interval '4 days'),
(5,8,5,5,'Mức đường phù hợp với sở thích.',now()-interval '3 days'),
(6,9,2,3,'Lớp kem hơi mặn so với khẩu vị.',now()-interval '2 days'),
(7,10,4,4,'Hương cam rõ, hậu vị cà phê dễ uống.',now()-interval '1 day'),
(8,11,6,2,'Lần trước đồ uống còn khá ngọt.',now()-interval '10 days');
SELECT crm_xu_ly_phan_hoi(3,1,'da_xem');
SELECT crm_xu_ly_phan_hoi(2,3,'da_tiep_thu');
SELECT crm_xu_ly_phan_hoi(2,8,'da_tiep_thu');
-- Khóa sau khi khách đã có phản hồi để minh họa lịch sử vẫn còn.
SELECT crm_dat_trang_thai_khach_hang(2,11,'locked');
INSERT INTO khao_sat(id,tieu_de,mo_ta,nguoi_tao_id,ngay_ket_thuc) VALUES
(1,'Khảo sát ra mắt Cold Brew Trái Cây','Chọn mức giá và loại quả yêu thích.',2,now()+interval '14 days'),
(2,'Khảo sát đồ uống ít ngọt','Thăm dò mức đường và lựa chọn mới.',2,now()+interval '7 days'),
(3,'Khảo sát trải nghiệm tại quán','Bản nháp để demo tạo và phát hành.',1,NULL);
INSERT INTO cau_hoi(id,khao_sat_id,noi_dung,thu_tu,bat_buoc) VALUES
(1,1,'Bạn sẵn sàng chi trả mức giá nào?',1,true),
(2,1,'Bạn thích Cold Brew kết hợp loại quả nào?',2,true),
(3,2,'Bạn thích mức đường nào?',1,true),
(4,2,'Bạn muốn thử đồ uống nào tiếp theo?',2,true),
(5,3,'Bạn đánh giá không gian quán thế nào?',1,true),
(6,3,'Bạn thường ghé quán vào thời điểm nào?',2,false);
INSERT INTO lua_chon(id,cau_hoi_id,noi_dung,thu_tu) VALUES
(1,1,'Từ 35.000 đến dưới 45.000 đồng',1),
(2,1,'Từ 45.000 đến 55.000 đồng',2),
(3,1,'Trên 55.000 đồng',3),
(4,2,'Cam sả',1),(5,2,'Vải',2),(6,2,'Mơ đào',3),
(7,3,'Không đường',1),(8,3,'30% đường',2),(9,3,'50% đường',3),
(10,4,'Trà sen ít đường',1),(11,4,'Cold Brew nguyên bản',2),(12,4,'Trà trái cây ít đường',3),
(13,5,'Rất thoải mái',1),(14,5,'Bình thường',2),(15,5,'Cần cải thiện',3),
(16,6,'Buổi sáng',1),(17,6,'Buổi chiều',2),(18,6,'Buổi tối',3);
SELECT crm_phat_hanh_khao_sat(2,1);
SELECT crm_nop_khao_sat(4,1,'[{"cau_hoi_id":1,"lua_chon_id":1},{"cau_hoi_id":2,"lua_chon_id":4}]');
SELECT crm_nop_khao_sat(5,1,'[{"cau_hoi_id":1,"lua_chon_id":2},{"cau_hoi_id":2,"lua_chon_id":4}]');
SELECT crm_nop_khao_sat(6,1,'[{"cau_hoi_id":1,"lua_chon_id":2},{"cau_hoi_id":2,"lua_chon_id":5}]');
SELECT crm_nop_khao_sat(7,1,'[{"cau_hoi_id":1,"lua_chon_id":3},{"cau_hoi_id":2,"lua_chon_id":6}]');
SELECT crm_phat_hanh_khao_sat(2,2,ARRAY[4,6,8]::bigint[]);
SELECT crm_nop_khao_sat(4,2,'[{"cau_hoi_id":3,"lua_chon_id":8},{"cau_hoi_id":4,"lua_chon_id":10}]');
SELECT crm_nop_khao_sat(6,2,'[{"cau_hoi_id":3,"lua_chon_id":7},{"cau_hoi_id":4,"lua_chon_id":11}]');
SELECT crm_dong_khao_sat(2,2);
-- Đồng bộ sequence sau khi chèn ID cụ thể, tránh trùng khóa khi thêm mới.
SELECT setval(pg_get_serial_sequence('nhom_so_thich','id'),(SELECT max(id) FROM nhom_so_thich),true);
SELECT setval(pg_get_serial_sequence('tai_khoan','id'),(SELECT max(id) FROM tai_khoan),true);
SELECT setval(pg_get_serial_sequence('do_uong','id'),(SELECT max(id) FROM do_uong),true);
SELECT setval(pg_get_serial_sequence('phan_hoi','id'),(SELECT max(id) FROM phan_hoi),true);
SELECT setval(pg_get_serial_sequence('khao_sat','id'),(SELECT max(id) FROM khao_sat),true);
SELECT setval(pg_get_serial_sequence('cau_hoi','id'),(SELECT max(id) FROM cau_hoi),true);
SELECT setval(pg_get_serial_sequence('lua_chon','id'),(SELECT max(id) FROM lua_chon),true);
COMMIT;
