"""SQLite setup and small database helpers for Stockwise Inventory."""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


BACKEND_DIR = Path(__file__).resolve().parent
DATABASE_PATH = Path(
    os.environ.get("INVENTORY_DB_PATH", str(BACKEND_DIR / "inventory.db"))
)


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    """Open a database connection and close it after each use."""
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database() -> None:
    """Create the tables and add a few examples to a brand-new database."""
    with connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                sku TEXT UNIQUE,
                price REAL NOT NULL CHECK (price >= 0),
                quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
                low_stock_threshold INTEGER NOT NULL DEFAULT 5
                    CHECK (low_stock_threshold >= 0),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS stock_movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                movement_type TEXT NOT NULL
                    CHECK (movement_type IN ('received', 'sold')),
                quantity INTEGER NOT NULL CHECK (quantity > 0),
                note TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (product_id) REFERENCES products(id)
                    ON DELETE CASCADE
            );
            """
        )

        product_count = connection.execute(
            "SELECT COUNT(*) FROM products"
        ).fetchone()[0]
        product_history = connection.execute(
            "SELECT 1 FROM sqlite_sequence WHERE name = 'products' LIMIT 1"
        ).fetchone()
        if product_count == 0 and product_history is None:
            examples = [
                ("Ceramic coffee mug", "MUG-001", 14.50, 24, 6),
                ("Canvas tote bag", "BAG-014", 22.00, 12, 4),
                ("Desk plant", "HOME-008", 18.75, 3, 5),
                ("Notebook set", "PAP-022", 9.99, 32, 8),
                ("Insulated bottle", "BOT-006", 28.00, 0, 5),
            ]
            for example in examples:
                cursor = connection.execute(
                    """
                    INSERT INTO products
                        (name, sku, price, quantity, low_stock_threshold)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    example,
                )
                if example[3] > 0:
                    connection.execute(
                        """
                        INSERT INTO stock_movements
                            (product_id, movement_type, quantity, note)
                        VALUES (?, 'received', ?, 'Starting example stock')
                        """,
                        (cursor.lastrowid, example[3]),
                    )


def product_to_dict(row: sqlite3.Row) -> dict:
    """Convert a product database row into a JSON-friendly dictionary."""
    product = dict(row)
    product["price"] = round(float(product["price"]), 2)
    product["is_low_stock"] = product["quantity"] <= product["low_stock_threshold"]
    return product
