"""Small, deterministic Chinook-style SQLite database for the hosted demo."""

from pathlib import Path
import sqlite3

SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS artists (
  ArtistId INTEGER PRIMARY KEY,
  Name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS albums (
  AlbumId INTEGER PRIMARY KEY,
  Title TEXT NOT NULL,
  ArtistId INTEGER NOT NULL REFERENCES artists(ArtistId)
);
CREATE TABLE IF NOT EXISTS genres (
  GenreId INTEGER PRIMARY KEY,
  Name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media_types (
  MediaTypeId INTEGER PRIMARY KEY,
  Name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tracks (
  TrackId INTEGER PRIMARY KEY,
  Name TEXT NOT NULL,
  AlbumId INTEGER REFERENCES albums(AlbumId),
  MediaTypeId INTEGER REFERENCES media_types(MediaTypeId),
  GenreId INTEGER REFERENCES genres(GenreId),
  Composer TEXT,
  Milliseconds INTEGER,
  Bytes INTEGER,
  UnitPrice REAL
);
CREATE TABLE IF NOT EXISTS customers (
  CustomerId INTEGER PRIMARY KEY,
  FirstName TEXT NOT NULL,
  LastName TEXT NOT NULL,
  Company TEXT,
  Address TEXT,
  City TEXT,
  State TEXT,
  Country TEXT,
  Email TEXT
);
CREATE TABLE IF NOT EXISTS employees (
  EmployeeId INTEGER PRIMARY KEY,
  LastName TEXT NOT NULL,
  FirstName TEXT NOT NULL,
  Title TEXT,
  City TEXT,
  Country TEXT,
  Email TEXT
);
CREATE TABLE IF NOT EXISTS invoices (
  InvoiceId INTEGER PRIMARY KEY,
  CustomerId INTEGER REFERENCES customers(CustomerId),
  InvoiceDate TEXT,
  BillingCountry TEXT,
  Total REAL
);
CREATE TABLE IF NOT EXISTS invoice_lines (
  InvoiceLineId INTEGER PRIMARY KEY,
  InvoiceId INTEGER REFERENCES invoices(InvoiceId),
  TrackId INTEGER REFERENCES tracks(TrackId),
  UnitPrice REAL,
  Quantity INTEGER
);
CREATE TABLE IF NOT EXISTS playlists (
  PlaylistId INTEGER PRIMARY KEY,
  Name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS playlist_tracks (
  PlaylistId INTEGER REFERENCES playlists(PlaylistId),
  TrackId INTEGER REFERENCES tracks(TrackId),
  PRIMARY KEY (PlaylistId, TrackId)
);
"""

def ensure_demo_database(path: str | Path) -> None:
    db_path = Path(path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        if tables:
            return
        conn.executescript(SCHEMA)

        artists = [
            (1, "AC/DC"), (2, "Accept"), (3, "Aerosmith"), (4, "Alanis Morissette"),
            (5, "Alice In Chains"), (6, "Apocalyptica"), (7, "Audioslave"),
            (8, "Black Sabbath"), (9, "Iron Maiden"), (10, "Metallica"),
            (11, "Miles Davis"), (12, "Nirvana"), (13, "Queen"), (14, "U2"),
            (15, "The Beatles")
        ]
        conn.executemany("INSERT INTO artists VALUES (?,?)", artists)

        albums = [
            (1, "For Those About To Rock", 1), (2, "Restless and Wild", 2),
            (3, "Big Ones", 3), (4, "Jagged Little Pill", 4),
            (5, "Facelift", 5), (6, "Plays Metallica By Four Cellos", 6),
            (7, "Audioslave", 7), (8, "Paranoid", 8), (9, "The Number of the Beast", 9),
            (10, "Master of Puppets", 10), (11, "Kind of Blue", 11),
            (12, "Nevermind", 12), (13, "A Night at the Opera", 13),
            (14, "Achtung Baby", 14), (15, "Abbey Road", 15)
        ]
        conn.executemany("INSERT INTO albums VALUES (?,?,?)", albums)

        genres = [(1,"Rock"), (2,"Metal"), (3,"Jazz"), (4,"Alternative"), (5,"Pop")]
        media = [(1,"MPEG audio file"), (2,"Protected AAC audio file")]
        conn.executemany("INSERT INTO genres VALUES (?,?)", genres)
        conn.executemany("INSERT INTO media_types VALUES (?,?)", media)

        tracks = []
        for i in range(1, 61):
            album_id = ((i - 1) % 15) + 1
            genre_id = 2 if album_id in (2,6,8,9,10) else (3 if album_id == 11 else (5 if album_id in (4,15) else 1))
            tracks.append((i, f"Demo Track {i}", album_id, 1, genre_id, None, 180000 + (i * 1000), 5000000 + i * 10000, 0.99))
        conn.executemany("INSERT INTO tracks VALUES (?,?,?,?,?,?,?,?,?)", tracks)

        customers = [
            (1,"Harshil","Khandelwal",None,"MANIT Campus","Bhopal","MP","India","demo1@datapilot.local"),
            (2,"Aarav","Sharma",None,"MG Road","Indore","MP","India","demo2@datapilot.local"),
            (3,"Emma","Johnson",None,"Main Street","New York","NY","USA","demo3@datapilot.local"),
            (4,"Liam","Smith",None,"King Street","London",None,"UK","demo4@datapilot.local"),
            (5,"Sophia","Brown",None,"Queen Street","Toronto","ON","Canada","demo5@datapilot.local")
        ]
        conn.executemany("INSERT INTO customers VALUES (?,?,?,?,?,?,?,?,?)", customers)
        employees = [
            (1,"Adams","Andrew","General Manager","Edmonton","Canada","andrew@datapilot.local"),
            (2,"Edwards","Nancy","Sales Manager","Calgary","Canada","nancy@datapilot.local"),
            (3,"Peacock","Jane","Sales Support Agent","Calgary","Canada","jane@datapilot.local")
        ]
        conn.executemany("INSERT INTO employees VALUES (?,?,?,?,?,?,?)", employees)

        invoices = []
        for i in range(1, 21):
            customer_id = ((i - 1) % 5) + 1
            invoices.append((i, customer_id, f"2026-09-{(i % 28) + 1:02d}", ["India","USA","UK","Canada"][customer_id % 4], round(9.99 + i * 1.25, 2)))
        conn.executemany("INSERT INTO invoices VALUES (?,?,?,?,?)", invoices)

        lines = []
        line_id = 1
        for invoice_id in range(1, 21):
            for offset in range(3):
                track_id = ((invoice_id * 3 + offset - 1) % 60) + 1
                lines.append((line_id, invoice_id, track_id, 0.99, 1))
                line_id += 1
        conn.executemany("INSERT INTO invoice_lines VALUES (?,?,?,?,?)", lines)

        conn.executemany("INSERT INTO playlists VALUES (?,?)", [(1,"Rock Favorites"),(2,"Metal Essentials"),(3,"Jazz Classics"),(4,"Top Tracks")])
        playlist_rows = []
        for playlist_id in range(1,5):
            for track_id in range(playlist_id, 61, 4):
                playlist_rows.append((playlist_id, track_id))
        conn.executemany("INSERT INTO playlist_tracks VALUES (?,?)", playlist_rows)
        conn.commit()
