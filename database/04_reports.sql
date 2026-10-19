-- Các VIEW chỉ đọc để cấp dữ liệu cho dashboard; chạy sau 01 và 02.
BEGIN;

CREATE VIEW v_danh_sach_khach_hang AS
SELECT h.tai_khoan_id,h.ma_thanh_vien,h.ho_ten,h.nam_sinh,
       extract(year FROM current_date)::int - h.nam_sinh AS tuoi_uoc_tinh,
       h.gioi_tinh,s.ten_nhom AS so_thich,t.ten_dang_nhap,t.trang_thai,t.ngay_tao
FROM khach_hang h JOIN tai_khoan t ON t.id = h.tai_khoan_id
JOIN nhom_so_thich s ON s.id = h.so_thich_id;

-- Mẫu số: tất cả hồ sơ KH hiện còn trong DB, gồm cả tài khoản locked.
-- Nhãn chỉ mô tả độ tuổi; không suy luận nghề nghiệp từ tuổi.
CREATE VIEW v_bao_cao_do_tuoi AS
WITH nhom(thu_tu,nhom_tuoi,tuoi_tu,tuoi_den) AS (
  VALUES (1,'Dưới 18',0,17),(2,'18–24',18,24),(3,'25–35',25,35),(4,'Trên 35',36,9999)
), tuoi AS (
  SELECT extract(year FROM current_date)::int - nam_sinh AS tuoi FROM khach_hang
)
SELECT n.thu_tu,n.nhom_tuoi,count(t.tuoi) AS so_khach_hang,
       round(100.0 * count(t.tuoi) / nullif((SELECT count(*) FROM tuoi),0),2) AS ty_le_phan_tram
FROM nhom n LEFT JOIN tuoi t ON t.tuoi BETWEEN n.tuoi_tu AND n.tuoi_den
GROUP BY n.thu_tu,n.nhom_tuoi;

CREATE VIEW v_bao_cao_so_thich AS
SELECT s.id,s.ten_nhom,count(h.tai_khoan_id) AS so_khach_hang,
       round(100.0 * count(h.tai_khoan_id) / nullif((SELECT count(*) FROM khach_hang),0),2) AS ty_le_phan_tram
FROM nhom_so_thich s LEFT JOIN khach_hang h ON h.so_thich_id = s.id
GROUP BY s.id,s.ten_nhom;

-- Đếm trên phân phối, không JOIN câu trả lời để tránh nhân số lượng người nhận.
CREATE VIEW v_tien_do_khao_sat AS
SELECT k.id AS khao_sat_id,k.tieu_de,k.trang_thai,k.ngay_ket_thuc,
       count(p.khach_hang_id) AS so_nguoi_duoc_gui,
       count(p.ngay_hoan_thanh) AS so_nguoi_da_lam,
       count(p.khach_hang_id) - count(p.ngay_hoan_thanh) AS so_nguoi_chua_lam,
       round(100.0 * count(p.ngay_hoan_thanh) / nullif(count(p.khach_hang_id),0),2) AS ty_le_hoan_thanh
FROM khao_sat k LEFT JOIN phan_phoi_khao_sat p ON p.khao_sat_id = k.id
GROUP BY k.id,k.tieu_de,k.trang_thai,k.ngay_ket_thuc;

-- Mẫu số từng câu: tổng câu trả lời của câu đó trong các bài đã nộp.
-- Câu không bắt buộc có thể có mẫu số nhỏ hơn tổng người hoàn thành.
-- Lựa chọn chưa được chọn vẫn xuất hiện, số lượt = 0.
CREATE VIEW v_ket_qua_khao_sat AS
WITH da_nop AS (
  SELECT a.* FROM cau_tra_loi a JOIN phan_phoi_khao_sat p
    ON p.khao_sat_id = a.khao_sat_id AND p.khach_hang_id = a.khach_hang_id
  WHERE p.ngay_hoan_thanh IS NOT NULL
), dem AS (
  SELECT c.khao_sat_id,c.id AS cau_hoi_id,c.noi_dung AS cau_hoi,c.thu_tu AS thu_tu_cau,
         l.id AS lua_chon_id,l.noi_dung AS lua_chon,l.thu_tu AS thu_tu_lua_chon,
         count(a.lua_chon_id) AS so_luot_chon
  FROM cau_hoi c JOIN lua_chon l ON l.cau_hoi_id = c.id
  LEFT JOIN da_nop a ON a.cau_hoi_id = c.id AND a.lua_chon_id = l.id
  GROUP BY c.khao_sat_id,c.id,c.noi_dung,c.thu_tu,l.id,l.noi_dung,l.thu_tu
)
SELECT *,sum(so_luot_chon) OVER (PARTITION BY cau_hoi_id) AS so_nguoi_tra_loi_cau,
       round(100.0 * so_luot_chon / nullif(sum(so_luot_chon) OVER (PARTITION BY cau_hoi_id),0),2) AS ty_le_phan_tram
FROM dem;

CREATE VIEW v_danh_gia_do_uong AS
SELECT d.id,d.ma_do_uong,d.ten_do_uong,count(p.id) AS so_phan_hoi,
       round(avg(p.so_sao),2) AS diem_trung_binh,
       count(p.id) FILTER (WHERE p.trang_thai = 'moi') AS so_phan_hoi_chua_xu_ly
FROM do_uong d LEFT JOIN phan_hoi p ON p.do_uong_id = d.id
GROUP BY d.id,d.ma_do_uong,d.ten_do_uong;

COMMIT;

-- Các truy vấn này chỉ đọc, có thể chạy trực tiếp trong pgAdmin.
SELECT * FROM v_bao_cao_do_tuoi ORDER BY thu_tu;
SELECT * FROM v_bao_cao_so_thich ORDER BY id;
SELECT * FROM v_tien_do_khao_sat ORDER BY khao_sat_id;
SELECT * FROM v_ket_qua_khao_sat ORDER BY khao_sat_id,thu_tu_cau,thu_tu_lua_chon;
SELECT * FROM v_danh_gia_do_uong ORDER BY id;
