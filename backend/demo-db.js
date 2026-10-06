import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const PRODUCTS = [
["Laptop Pro","Electronics",1299,850],["Wireless Headphones","Electronics",149,70],["Smartphone X","Electronics",799,510],["4K Monitor","Electronics",429,250],["Mechanical Keyboard","Electronics",99,45],
["Running Shoes","Footwear",89,42],["Trail Shoes","Footwear",119,58],["Casual Sneakers","Footwear",79,36],["Leather Boots","Footwear",139,72],["Walking Sandals","Footwear",49,22],
["Hoodie","Apparel",59,25],["Denim Jacket","Apparel",89,40],["Cotton T-Shirt","Apparel",29,11],["Chino Pants","Apparel",69,30],["Winter Coat","Apparel",149,76],
["Backpack","Accessories",54,27],["Leather Wallet","Accessories",34,15],["Sunglasses","Accessories",44,19],["Coffee Maker","Home & Kitchen",99,55],["Air Fryer","Home & Kitchen",109,61],
["Water Bottle","Home & Kitchen",22,9],["Desk Lamp","Home & Kitchen",32,14],["Yoga Mat","Sports",29,12],["Dumbbell Set","Sports",79,43]
];
const FIRST=["Aarav","Vivaan","Aditya","Arjun","Ishaan","Kabir","Riya","Anaya","Meera","Diya","Aanya","Vihaan","Reyansh","Sara","Nisha","Kavya","Maya","Zoya"];
const LAST=["Sharma","Verma","Patel","Khan","Gupta","Mehta","Jain","Singh","Iyer","Rao","Kapoor","Das","Malhotra","Joshi","Bose"];
const LOCATIONS=[["Bengaluru","Karnataka","India"],["Mumbai","Maharashtra","India"],["Delhi","Delhi","India"],["Hyderabad","Telangana","India"],["Pune","Maharashtra","India"],["Chennai","Tamil Nadu","India"],["New York","New York","USA"],["London","England","UK"],["Toronto","Ontario","Canada"]];
const STATUSES=["delivered","delivered","delivered","shipped","processing","cancelled","returned"];
const PAYMENTS=["credit_card","debit_card","upi","paypal","net_banking"];
const CARRIERS=["Delhivery","Blue Dart","FedEx","DHL","UPS"];
let seed=42;
function rand(){ seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }
function int(min,max){ return Math.floor(rand()*(max-min+1))+min; }
function choice(a){ return a[int(0,a.length-1)]; }
function money(n){ return Math.round(n*100)/100; }
function dateBetween(start,end){ return new Date(start.getTime()+rand()*(end.getTime()-start.getTime())); }
function sqlDate(d){ return d.toISOString().slice(0,19).replace("T"," "); }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (category_id INTEGER PRIMARY KEY, category_name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sellers (seller_id INTEGER PRIMARY KEY, seller_name TEXT NOT NULL, city TEXT, country TEXT, rating REAL);
CREATE TABLE IF NOT EXISTS customers (customer_id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT UNIQUE, city TEXT, state TEXT, country TEXT, signup_date TEXT);
CREATE TABLE IF NOT EXISTS products (product_id INTEGER PRIMARY KEY, product_name TEXT, category_id INTEGER, seller_id INTEGER, price REAL, cost REAL, stock INTEGER, listed_date TEXT, FOREIGN KEY(category_id) REFERENCES categories(category_id), FOREIGN KEY(seller_id) REFERENCES sellers(seller_id));
CREATE TABLE IF NOT EXISTS orders (order_id INTEGER PRIMARY KEY, customer_id INTEGER, order_date TEXT, status TEXT, city TEXT, state TEXT, country TEXT, subtotal REAL, shipping_fee REAL, discount REAL, total_amount REAL, FOREIGN KEY(customer_id) REFERENCES customers(customer_id));
CREATE TABLE IF NOT EXISTS order_items (order_item_id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER, quantity INTEGER, unit_price REAL, line_total REAL, FOREIGN KEY(order_id) REFERENCES orders(order_id), FOREIGN KEY(product_id) REFERENCES products(product_id));
CREATE TABLE IF NOT EXISTS payments (payment_id INTEGER PRIMARY KEY, order_id INTEGER, payment_date TEXT, payment_method TEXT, payment_status TEXT, amount REAL, FOREIGN KEY(order_id) REFERENCES orders(order_id));
CREATE TABLE IF NOT EXISTS reviews (review_id INTEGER PRIMARY KEY, customer_id INTEGER, product_id INTEGER, rating INTEGER, review_text TEXT, review_date TEXT, FOREIGN KEY(customer_id) REFERENCES customers(customer_id), FOREIGN KEY(product_id) REFERENCES products(product_id));
CREATE TABLE IF NOT EXISTS shipments (shipment_id INTEGER PRIMARY KEY, order_id INTEGER, shipped_at TEXT, delivered_at TEXT, carrier TEXT, shipment_status TEXT, FOREIGN KEY(order_id) REFERENCES orders(order_id));
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
`;

export function ensureDemoDatabase(filePath) {
  const dbPath=path.resolve(filePath);
  fs.mkdirSync(path.dirname(dbPath),{recursive:true});
  let db=new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");

  const existing=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if (existing.length) {
    const requiredCounts = [
      ["categories", 6],
      ["sellers", 6],
      ["customers", 500],
      ["products", 120],
      ["orders", 3000],
      ["order_items", 3000],
      ["payments", 3000],
      ["reviews", 1600],
      ["shipments", 3000],
    ];
    const healthy = requiredCounts.every(([table, minimum]) => {
      try {
        const row = db.prepare("SELECT COUNT(*) AS count FROM " + table).get();
        return Number(row?.count ?? 0) >= minimum;
      } catch {
        return false;
      }
    });

    if (healthy) {
      db.close();
      return;
    }

    // A previous seed may have failed after creating the tables, leaving a
    // partially populated database. Rebuild the disposable demo database.
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
    }
    db=new DatabaseSync(dbPath);
    db.exec("PRAGMA foreign_keys = ON");
  }

  db.exec(SCHEMA);

  const categoryNames=[...new Set(PRODUCTS.map(p=>p[1]))];
  const sellers=[
    [1,"TechCart India","Bengaluru","India",4.7],[2,"Urban Essentials","Mumbai","India",4.5],[3,"Global Goods","Delhi","India",4.6],
    [4,"Prime Marketplace","New York","USA",4.4],[5,"Northstar Retail","London","UK",4.8],[6,"Maple Commerce","Toronto","Canada",4.3]
  ];
  const addCategory=db.prepare("INSERT INTO categories VALUES (?,?)");
  categoryNames.forEach((n,i)=>addCategory.run(i+1,n));
  const addSeller=db.prepare("INSERT INTO sellers VALUES (?,?,?,?,?)"); sellers.forEach(r=>addSeller.run(...r));

  const start=new Date("2025-01-01T00:00:00Z"), end=new Date("2026-09-15T23:59:59Z");
  const products=[];
  let pid=1;
  for(const [base,cat,price,cost] of PRODUCTS){
    for(let v=1;v<=5;v++){
      products.push([pid,`${base} ${v}`,categoryNames.indexOf(cat)+1,((pid-1)%6)+1,money(price*(.92+v*.025)),money(cost*(.92+v*.02)),int(5,250),sqlDate(dateBetween(new Date("2025-01-01"),new Date("2026-06-30")))]);
      pid++;
    }
  }
  const addProduct=db.prepare("INSERT INTO products VALUES (?,?,?,?,?,?,?,?)"); products.forEach(r=>addProduct.run(...r));

  const addCustomer=db.prepare("INSERT INTO customers VALUES (?,?,?,?,?,?,?,?)");
  for(let id=1;id<=500;id++){
    const loc=choice(LOCATIONS), first=choice(FIRST), last=choice(LAST);
    addCustomer.run(id,first,last,`${first.toLowerCase()}.${last.toLowerCase()}${id}@demo.datapilot.local`,loc[0],loc[1],loc[2],sqlDate(dateBetween(new Date("2024-01-01"),new Date("2026-08-31"))).slice(0,10));
  }

  const addOrder=db.prepare("INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  const addItem=db.prepare("INSERT INTO order_items VALUES (?,?,?,?,?,?)");
  const addPayment=db.prepare("INSERT INTO payments VALUES (?,?,?,?,?,?)");
  const addShipment=db.prepare("INSERT INTO shipments VALUES (?,?,?,?,?,?)");
  let itemId=1;
  for(let oid=1;oid<=3000;oid++){
    const cid=int(1,500), orderDate=dateBetween(start,end), status=choice(STATUSES), loc=choice(LOCATIONS);
    const selected=[]; const used=new Set(); const count=int(1,5);
    while(selected.length<count){ const p=choice(products); if(!used.has(p[0])){used.add(p[0]);selected.push(p);} }
    // Build child rows first so the order total can be calculated.
    // Insert the parent order before its FK-dependent child rows.
    const itemRows=[];
    let subtotal=0;
    for(const p of selected){
      const qty=int(1,3), total=money(qty*p[4]);
      subtotal+=total;
      itemRows.push([itemId++,oid,p[0],qty,p[4],total]);
    }
    subtotal=money(subtotal);
    const shipping=subtotal>=75?0:choice([4.99,7.99,9.99]), discount=money(subtotal*choice([0,0,.05,.10,.15])), total=money(subtotal+shipping-discount);
    addOrder.run(oid,cid,sqlDate(orderDate),status,loc[0],loc[1],loc[2],subtotal,shipping,discount,total);
    for(const row of itemRows) addItem.run(...row);
    addPayment.run(oid,oid,sqlDate(orderDate),choice(PAYMENTS),status==="cancelled"&&rand()<.25?"failed":"paid",total);
    let shipped=null,delivered=null;
    if(["shipped","delivered","returned"].includes(status)){ const sd=new Date(orderDate.getTime()+int(1,3)*86400000); shipped=sqlDate(sd); if(["delivered","returned"].includes(status)) delivered=sqlDate(new Date(sd.getTime()+int(1,6)*86400000)); }
    addShipment.run(oid,oid,shipped,delivered,choice(CARRIERS),status==="delivered"?"delivered":status==="returned"?"returned":status==="shipped"?"shipped":"pending");
  }

  const addReview=db.prepare("INSERT INTO reviews VALUES (?,?,?,?,?,?)");
  const texts=["Great value for the price.","Works exactly as expected.","Fast delivery and good quality.","Average product, but acceptable.","Not what I expected from the listing."];
  function randomRating(){
    const r=rand();
    if(r<0.03) return 1;
    if(r<0.08) return 2;
    if(r<0.20) return 3;
    if(r<0.50) return 4;
    return 5;
  }
  for(let id=1;id<=1600;id++) addReview.run(id,int(1,500),int(1,120),randomRating(),choice(texts),sqlDate(dateBetween(start,end)).slice(0,10));

  db.close();
}
