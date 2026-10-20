# Hôm nay ăn gì? — Vòng quay món ShopeeFood

Dán link chia sẻ quán ShopeeFood (vd `https://shopeefood.vn/u/t7jp6ms`), tool tự lấy thực đơn, đưa các món vào vòng quay và chọn ngẫu nhiên 1 món.

## Chạy

Yêu cầu: Node.js 18+ và Google Chrome (hoặc Chromium).

```bash
npm install
node server.mjs            # mở http://localhost:3000
PORT=8080 node server.mjs  # đổi cổng
CHROME_PATH=/usr/bin/chromium node server.mjs  # nếu Chrome không nằm ở /usr/bin/google-chrome
```

## Cách hoạt động

API của ShopeeFood yêu cầu request có chữ ký, gọi trực tiếp sẽ bị chặn. Vì vậy server mở trang quán bằng Chrome headless (puppeteer-core) rồi đọc các response `get_detail` / `get_delivery_dishes` mà trang tự gọi.

- `GET /api/menu?url=<link>` trả về `{ shop: {name, address}, dishes: [{id, name, price, priceText, category, image}] }`
- Chỉ nhận link `https://shopeefood.vn/...` hoặc `https://shopeefood.shopee.vn/...` (app mới của Shopee, cùng dữ liệu)
- Kết quả được cache trong RAM 10 phút
- Bỏ các món hết hàng hoặc ngừng bán, món giá 1đ (món giữ chỗ) và các món trùng lặp trong nhóm khuyến mãi

## Quán gần tôi + quay quán

Nút 📍 xin vị trí trình duyệt (bị từ chối thì cho chọn tỉnh/quận bằng tay). Web ShopeeFood không lọc theo toạ độ, nên server mở trang tìm kiếm "đồ ăn" của thành phố gần nhất, lọc theo quận gần nhất cùng các quận có tâm cách dưới 6 km (tối đa 5 quận), lật vài trang kết quả rồi sắp xếp theo khoảng cách.

- `GET /api/nearby?lat=&lng=` trả về `{ city, districts: [tên], shops: [{id, name, address, url, image, km, rating, open}] }` (40 quán gần nhất, giới hạn 6 lần/phút mỗi IP)
- `GET /api/areas` trả về danh sách tỉnh/quận kèm toạ độ (cache 24 giờ)
- Lần tìm đầu mất khoảng 10–20 giây, sau đó cache 45 phút theo nhóm quận
- Trên giao diện: quay quán → trúng quán nào bấm "Quay món ở quán này" để tải thực đơn và quay món như bình thường

## Thông báo chung (nhiều người dùng)

Mỗi trình duyệt được gán một tên ảo `user_XXXX`, lưu trong localStorage. Khi ai đó quay ra món hoặc bấm "Chốt món này!", server phát thông báo tới mọi người đang mở app qua Server-Sent Events. Không cần database.

- `POST /api/events` với body `{ kind: "spin" | "pick", user: "user_1234", dish, shop }`; mỗi IP gửi tối đa 8 sự kiện / 10 giây
- `GET /api/events/stream` là luồng SSE: khi mới kết nối, server gửi sự kiện `backlog` (30 sự kiện gần nhất), sau đó gửi từng sự kiện mới
- Lịch sử chung chỉ nằm trong RAM nên sẽ mất khi restart server

## Deploy public qua Cloudflare Tunnel

Tool cần Chrome headless để đọc thực đơn nên không chạy được trên Cloudflare Workers/Pages. Thay vào đó, container chạy trên máy chủ và Cloudflare Tunnel đưa nó ra domain public, không cần mở port.

```bash
cloudflared tunnel create shopeefood-wheel
cloudflared tunnel route dns shopeefood-wheel food.deeplearning.io.vn
# đặt config.yml + creds.json vào một thư mục, ingress trỏ tới http://wheel:3000
echo "TUNNEL_DIR=/home/phucit/deploy/shopeefood-wheel" > .env
docker compose --profile cloudflare up -d --build
```

`cloudflared tunnel route dns` chỉ tạo được bản ghi trong đúng zone đã chọn lúc `cloudflared tunnel login`. Nếu domain nằm ở zone khác, lệnh sẽ tạo nhầm `food.<domain>.<zone-cũ>`. Khi đó hãy tạo bản ghi trong dashboard: CNAME `food` → `<tunnel-id>.cfargotunnel.com`, bật Proxied.

Giới hạn khi chạy public:
- Tối đa 3 tab Chrome cùng lúc, 10 yêu cầu xếp hàng
- Mỗi IP lấy thực đơn tối đa 10 lần / phút (IP thật lấy từ header `cf-connecting-ip`)
- Cache tối đa 200 quán
