"""Deterministic e-commerce SQLite database for the hosted DataPilot demo.

The demo is realistic enough to exercise joins, aggregation, filtering,
date analysis, customer analytics, product analytics, payments, reviews,
and logistics. It is seeded only when the database has no tables.
"""

from pathlib import Path
import random
import sqlite3
from datetime import datetime, timedelta

SEED = 42

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  customer_id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  country TEXT NOT NULL,
  signup_date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sellers (
  seller_id INTEGER PRIMARY KEY,
  seller_name TEXT NOT NULL,
  seller_city TEXT NOT NULL,
  seller_country TEXT NOT NULL,
  rating REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  category_id INTEGER PRIMARY KEY,
  category_name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS products (
  product_id INTEGER PRIMARY KEY,
  product_name TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(category_id),
  seller_id INTEGER NOT NULL REFERENCES sellers(seller_id),
  price REAL NOT NULL,
  cost REAL NOT NULL,
  stock_quantity INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  order_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
  order_date TEXT NOT NULL,
  status TEXT NOT NULL,
  shipping_city TEXT NOT NULL,
  shipping_state TEXT NOT NULL,
  shipping_country TEXT NOT NULL,
  subtotal REAL NOT NULL,
  shipping_fee REAL NOT NULL,
  discount REAL NOT NULL,
  total_amount REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  order_item_id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(order_id),
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  item_total REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  payment_id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(order_id),
  payment_date TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  amount REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  review_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT,
  review_date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shipments (
  shipment_id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(order_id),
  shipped_date TEXT,
  delivered_date TEXT,
  carrier TEXT NOT NULL,
  shipping_status TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
"""

FIRST_NAMES = [
    "Aarav","Vivaan","Aditya","Arjun","Kabir","Rohan","Ishaan","Reyansh",
    "Aanya","Ananya","Diya","Ira","Meera","Sara","Emma","Olivia",
    "Liam","Noah","Sophia","Mia","Lucas","Ethan","Ava","Mason"
]
LAST_NAMES = [
    "Sharma","Khan","Patel","Verma","Gupta","Mehta","Singh","Khandelwal",
    "Brown","Smith","Johnson","Williams","Davis","Wilson","Taylor","Martin"
]
LOCATIONS = [
    ("Bhopal","Madhya Pradesh","India"),("Indore","Madhya Pradesh","India"),
    ("Mumbai","Maharashtra","India"),("Delhi","Delhi","India"),
    ("Bengaluru","Karnataka","India"),("Pune","Maharashtra","India"),
    ("Hyderabad","Telangana","India"),("Jaipur","Rajasthan","India"),
    ("New York","NY","USA"),("London","England","UK"),("Toronto","Ontario","Canada")
]
PRODUCTS = [
    ("Wireless Headphones","Electronics",79.99,42.00),
    ("Mechanical Keyboard","Electronics",119.99,68.00),
    ("USB-C Hub","Electronics",39.99,18.00),
    ("Smart Watch","Electronics",149.99,92.00),
    ("Bluetooth Speaker","Electronics",59.99,31.00),
    ("Running Shoes","Footwear",89.99,48.00),
    ("Casual Sneakers","Footwear",69.99,36.00),
    ("Hiking Boots","Footwear",129.99,72.00),
    ("Cotton T-Shirt","Apparel",24.99,10.00),
    ("Denim Jacket","Apparel",64.99,31.00),
    ("Hoodie","Apparel",49.99,24.00),
    ("Backpack","Accessories",54.99,27.00),
    ("Leather Wallet","Accessories",34.99,15.00),
    ("Sunglasses","Accessories",44.99,19.00),
    ("Coffee Maker","Home & Kitchen",99.99,55.00),
    ("Air Fryer","Home & Kitchen",109.99,61.00),
    ("Water Bottle","Home & Kitchen",22.99,9.00),
    ("Desk Lamp","Home & Kitchen",32.99,14.00),
    ("Yoga Mat","Sports",29.99,12.00),
    ("Dumbbell Set","Sports",79.99,43.00)
]
STATUSES = ["delivered","delivered","delivered","shipped","processing","cancelled","returned"]
PAYMENT_METHODS = ["credit_card","debit_card","upi","paypal","net_banking"]
CARRIERS = ["Delhivery","Blue Dart","FedEx","DHL","UPS"]

def _date_for(rng, start, end):
    return start + timedelta(seconds=rng.randint(0, int((end-start).total_seconds())))

def ensure_demo_database(path: str | Path) -> None:
    db_path = Path(path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        existing = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
        if existing:
            return

        conn.executescript(SCHEMA)
        rng = random.Random(SEED)
        start, end = datetime(2025,1,1), datetime(2026,9,15)

        categories = sorted({p[1] for p in PRODUCTS})
        conn.executemany(
            "INSERT INTO categories(category_id,category_name) VALUES (?,?)",
            list(enumerate(categories,1))
        )
        category_id = {name:i for i,name in enumerate(categories,1)}

        sellers = [
            (1,"TechCart India","Bengaluru","India",4.7),
            (2,"Urban Essentials","Mumbai","India",4.5),
            (3,"Global Goods","Delhi","India",4.6),
            (4,"Prime Marketplace","New York","USA",4.4),
            (5,"Northstar Retail","London","UK",4.8),
            (6,"Maple Commerce","Toronto","Canada",4.3)
        ]
        conn.executemany("INSERT INTO sellers VALUES (?,?,?,?,?)", sellers)

        products = []
        pid = 1
        for base_name,cat,base_price,base_cost in PRODUCTS:
            for variant in range(1,6):
                price = round(base_price*(0.92+variant*0.025),2)
                cost = round(base_cost*(0.92+variant*0.02),2)
                products.append((
                    pid,f"{base_name} {variant}",category_id[cat],
                    ((pid-1)%len(sellers))+1,price,cost,rng.randint(5,250),
                    _date_for(rng,start,datetime(2026,6,30)).date().isoformat()
                ))
                pid += 1
        conn.executemany("INSERT INTO products VALUES (?,?,?,?,?,?,?,?)", products)

        customers = []
        for cid in range(1,501):
            first,last = rng.choice(FIRST_NAMES),rng.choice(LAST_NAMES)
            city,state,country = rng.choice(LOCATIONS)
            signup = _date_for(rng,datetime(2024,1,1),datetime(2026,8,31)).date().isoformat()
            email = f"{first.lower()}.{last.lower()}{cid}@demo.datapilot.local"
            customers.append((cid,first,last,email,city,state,country,signup))
        conn.executemany("INSERT INTO customers VALUES (?,?,?,?,?,?,?,?)", customers)

        orders,items,payments,shipments = [],[],[],[]
        for oid in range(1,3001):
            cid = rng.randint(1,500)
            order_dt = _date_for(rng,start,end)
            status = rng.choice(STATUSES)
            city,state,country = rng.choice(LOCATIONS)
            subtotal = 0.0
            for product in rng.sample(products,rng.randint(1,5)):
                qty = rng.randint(1,3)
                item_total = round(qty*product[4],2)
                subtotal += item_total
                items.append((len(items)+1,oid,product[0],qty,product[4],item_total))
            subtotal = round(subtotal,2)
            shipping = 0.0 if subtotal >= 75 else round(rng.choice([4.99,7.99,9.99]),2)
            discount = round(subtotal*rng.choice([0,0,0.05,0.10,0.15]),2)
            total = round(subtotal+shipping-discount,2)
            orders.append((oid,cid,order_dt.isoformat(timespec="seconds"),status,
                           city,state,country,subtotal,shipping,discount,total))

            pay_status = "failed" if status=="cancelled" and rng.random()<0.25 else "paid"
            payments.append((oid,oid,order_dt.isoformat(timespec="seconds"),
                             rng.choice(PAYMENT_METHODS),pay_status,total))

            shipped = delivered = None
            if status in {"shipped","delivered","returned"}:
                shipped_dt = order_dt + timedelta(days=rng.randint(1,3))
                shipped = shipped_dt.isoformat(timespec="seconds")
                if status in {"delivered","returned"}:
                    delivered = (shipped_dt+timedelta(days=rng.randint(1,6))).isoformat(timespec="seconds")
            ship_status = (
                "delivered" if status=="delivered" else
                "returned" if status=="returned" else
                "shipped" if status=="shipped" else "pending"
            )
            shipments.append((oid,oid,shipped,delivered,rng.choice(CARRIERS),ship_status))

        conn.executemany("INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?)", orders)
        conn.executemany("INSERT INTO order_items VALUES (?,?,?,?,?,?)", items)
        conn.executemany("INSERT INTO payments VALUES (?,?,?,?,?,?)", payments)
        conn.executemany("INSERT INTO shipments VALUES (?,?,?,?,?,?)", shipments)

        reviews = []
        for rid in range(1,1601):
            rating = rng.choices([1,2,3,4,5],weights=[3,5,12,30,50])[0]
            reviews.append((
                rid,rng.randint(1,500),rng.randint(1,len(products)),rating,
                rng.choice([
                    "Great value for the price.","Works exactly as expected.",
                    "Fast delivery and good quality.","Average product, but acceptable.",
                    "Not what I expected from the listing."
                ]),
                _date_for(rng,start,end).date().isoformat()
            ))
        conn.executemany("INSERT INTO reviews VALUES (?,?,?,?,?,?)", reviews)
        conn.commit()
