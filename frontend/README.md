# Frontend

Frontend JavaScript thuần, không cần Apache. Chạy API Node.js và PostgreSQL theo hướng dẫn ở [README.md](../README.md), sau đó trong PowerShell:

```powershell
cd C:\xampp\htdocs\MilkTea-Coffee\frontend
npm run dev
```

`npm run dev` mở ba cổng, mỗi cổng dành riêng cho một khu vực:

- Admin: http://127.0.0.1:4173/
- Manager: http://127.0.0.1:4174/
- Customer: http://127.0.0.1:4175/

API base URL mặc định là `http://127.0.0.1:3000`. Nếu đổi cổng hoặc host, cần cập nhật `FRONTEND_ORIGINS` trong `api/.env` cho khớp.
