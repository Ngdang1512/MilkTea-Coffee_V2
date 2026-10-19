-- Mở rộng nhóm sở thích khách hàng; giữ nguyên ID của dữ liệu hiện có.
-- Có thể chạy lại an toàn.
BEGIN;

UPDATE nhom_so_thich
SET ten_nhom = 'Cà phê & cà phê sữa',
    mo_ta = 'Ưa cà phê đậm, cà phê sữa, bạc xỉu hoặc cà phê muối',
    dang_su_dung = true
WHERE id = 2;

UPDATE nhom_so_thich
SET ten_nhom = 'Trà trái cây thanh mát',
    mo_ta = 'Ưa trà kết hợp trái cây, vị chua ngọt và hương thơm tự nhiên',
    dang_su_dung = true
WHERE id = 3;

INSERT INTO nhom_so_thich(ten_nhom, mo_ta, dang_su_dung) VALUES
  ('Matcha & trà xanh', 'Ưa vị trà xanh, matcha thơm và hơi đắng nhẹ', true),
  ('Cacao & socola', 'Ưa vị cacao, socola và đồ uống ngọt đậm', true),
  ('Topping đa dạng', 'Quan tâm trân châu, thạch, pudding và các loại topping', true),
  ('Kem béo & macchiato', 'Ưa lớp kem sữa, kem cheese hoặc macchiato', true),
  ('Hương vị theo mùa', 'Thích thử sản phẩm mới và hương vị giới hạn theo mùa', true)
ON CONFLICT (ten_nhom) DO UPDATE
SET mo_ta = EXCLUDED.mo_ta,
    dang_su_dung = true;

COMMIT;
