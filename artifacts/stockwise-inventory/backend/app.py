"""Flask API for the Stockwise Inventory web app."""

from __future__ import annotations

import math
import os
import sqlite3
from typing import Any

from flask import Flask, jsonify, request

from database import connect, initialize_database, product_to_dict


app = Flask(__name__)
API_PREFIX = "/stock-api"


def error(message: str, status: int = 400):
    """Return an easy-to-read JSON error for the web app."""
    return jsonify({"error": message}), status


def read_json() -> dict[str, Any]:
    """Read a JSON object, rejecting arrays and other unexpected values."""
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else {}


def required_text(value: Any, label: str, max_length: int = 120) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} is required.")
    result = value.strip()
    if len(result) > max_length:
        raise ValueError(f"{label} must be {max_length} characters or fewer.")
    return result


def optional_sku(value: Any) -> str | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if not isinstance(value, str):
        raise ValueError("SKU must be text.")
    result = value.strip()
    if len(result) > 40:
        raise ValueError("SKU must be 40 characters or fewer.")
    return result


def optional_text(value: Any, label: str, max_length: int) -> str | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if not isinstance(value, str):
        raise ValueError(f"{label} must be text.")
    result = value.strip()
    if len(result) > max_length:
        raise ValueError(f"{label} must be {max_length} characters or fewer.")
    return result


def non_negative_number(value: Any, label: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a number.")
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a number.") from None
    if not math.isfinite(result) or result < 0:
        raise ValueError(f"{label} cannot be negative.")
    return round(result, 2)


def whole_number(value: Any, label: str, minimum: int = 0) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a whole number.")
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a whole number.") from None
    if not math.isfinite(number) or not number.is_integer() or number < minimum:
        if minimum == 1:
            raise ValueError(f"{label} must be at least 1.")
        raise ValueError(f"{label} must be a whole number of {minimum} or more.")
    return int(number)


def product_values(body: dict[str, Any], *, include_quantity: bool) -> dict[str, Any]:
    values = {
        "name": required_text(body.get("name"), "Product name"),
        "sku": optional_sku(body.get("sku")),
        "category": optional_text(body.get("category"), "Category", 80),
        "supplier": optional_text(body.get("supplier"), "Supplier", 120),
        "price": non_negative_number(body.get("price"), "Price"),
        "low_stock_threshold": whole_number(
            body.get("low_stock_threshold", 5), "Low-stock level"
        ),
    }
    if include_quantity:
        values["quantity"] = whole_number(body.get("quantity", 0), "Quantity")
    return values


def find_product(connection: sqlite3.Connection, product_id: int):
    return connection.execute(
        "SELECT * FROM products WHERE id = ?", (product_id,)
    ).fetchone()


@app.get(f"{API_PREFIX}/health")
def health():
    return jsonify({"status": "ok"})


@app.get(f"{API_PREFIX}/products")
def list_products():
    search = request.args.get("q", "").strip()
    category = request.args.get("category", "").strip()
    supplier = request.args.get("supplier", "").strip()
    conditions = []
    parameters: list[str] = []
    if search:
        conditions.append(
            """
            (name LIKE ? COLLATE NOCASE
                OR COALESCE(sku, '') LIKE ? COLLATE NOCASE
                OR COALESCE(category, '') LIKE ? COLLATE NOCASE
                OR COALESCE(supplier, '') LIKE ? COLLATE NOCASE)
            """
        )
        search_pattern = f"%{search}%"
        parameters.extend([search_pattern] * 4)
    if category:
        conditions.append("category = ? COLLATE NOCASE")
        parameters.append(category)
    if supplier:
        conditions.append("supplier = ? COLLATE NOCASE")
        parameters.append(supplier)

    with connect() as connection:
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = connection.execute(
            f"SELECT * FROM products {where_clause} ORDER BY name COLLATE NOCASE",
            parameters,
        ).fetchall()
        categories = connection.execute(
            """
            SELECT DISTINCT category COLLATE NOCASE AS category FROM products
            WHERE category IS NOT NULL AND TRIM(category) != ''
            ORDER BY category COLLATE NOCASE
            """
        ).fetchall()
        suppliers = connection.execute(
            """
            SELECT DISTINCT supplier COLLATE NOCASE AS supplier FROM products
            WHERE supplier IS NOT NULL AND TRIM(supplier) != ''
            ORDER BY supplier COLLATE NOCASE
            """
        ).fetchall()
    return jsonify({
        "products": [product_to_dict(row) for row in rows],
        "categories": [row["category"] for row in categories],
        "suppliers": [row["supplier"] for row in suppliers],
    })


@app.post(f"{API_PREFIX}/products")
def create_product():
    try:
        values = product_values(read_json(), include_quantity=True)
        with connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO products
                    (name, sku, price, quantity, low_stock_threshold, category, supplier)
                VALUES
                    (:name, :sku, :price, :quantity, :low_stock_threshold, :category, :supplier)
                """,
                values,
            )
            product_id = cursor.lastrowid
            if values["quantity"] > 0:
                connection.execute(
                    """
                    INSERT INTO stock_movements
                        (product_id, movement_type, quantity, note)
                    VALUES (?, 'received', ?, 'Initial product stock')
                    """,
                    (product_id, values["quantity"]),
                )
            product = product_to_dict(find_product(connection, product_id))
        return jsonify({"product": product}), 201
    except ValueError as exc:
        return error(str(exc))
    except sqlite3.IntegrityError:
        return error("That SKU is already being used by another product.", 409)


@app.put(f"{API_PREFIX}/products/<int:product_id>")
def update_product(product_id: int):
    try:
        values = product_values(read_json(), include_quantity=False)
        with connect() as connection:
            if not find_product(connection, product_id):
                return error("Product not found.", 404)
            connection.execute(
                """
                UPDATE products
                SET name = :name, sku = :sku, price = :price,
                    category = :category, supplier = :supplier,
                    low_stock_threshold = :low_stock_threshold,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :id
                """,
                {**values, "id": product_id},
            )
            product = product_to_dict(find_product(connection, product_id))
        return jsonify({"product": product})
    except ValueError as exc:
        return error(str(exc))
    except sqlite3.IntegrityError:
        return error("That SKU is already being used by another product.", 409)


@app.delete(f"{API_PREFIX}/products/<int:product_id>")
def delete_product(product_id: int):
    with connect() as connection:
        cursor = connection.execute("DELETE FROM products WHERE id = ?", (product_id,))
        if cursor.rowcount == 0:
            return error("Product not found.", 404)
    return jsonify({"message": "Product deleted."})


@app.post(f"{API_PREFIX}/products/<int:product_id>/stock")
def record_stock_movement(product_id: int):
    body = read_json()
    movement_type = body.get("type")
    if movement_type not in ("received", "sold"):
        return error("Choose whether stock was received or sold.")
    try:
        quantity = whole_number(body.get("quantity"), "Quantity", minimum=1)
    except ValueError as exc:
        return error(str(exc))

    with connect() as connection:
        product = find_product(connection, product_id)
        if not product:
            return error("Product not found.", 404)
        new_quantity = product["quantity"] + quantity
        if movement_type == "sold":
            if quantity > product["quantity"]:
                return error(
                    f"Only {product['quantity']} units are in stock. "
                    "Record a smaller sale or receive more stock first."
                )
            new_quantity = product["quantity"] - quantity

        connection.execute(
            """
            UPDATE products
            SET quantity = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (new_quantity, product_id),
        )
        movement_cursor = connection.execute(
            """
            INSERT INTO stock_movements (product_id, movement_type, quantity)
            VALUES (?, ?, ?)
            """,
            (product_id, movement_type, quantity),
        )
        updated = product_to_dict(find_product(connection, product_id))
        movement = dict(
            connection.execute(
                "SELECT * FROM stock_movements WHERE id = ?",
                (movement_cursor.lastrowid,),
            ).fetchone()
        )
    return jsonify({"product": updated, "movement": movement})


@app.get(f"{API_PREFIX}/summary")
def summary():
    with connect() as connection:
        row = connection.execute(
            """
            SELECT
                COUNT(*) AS total_products,
                COALESCE(SUM(quantity), 0) AS total_stock_units,
                COALESCE(SUM(price * quantity), 0) AS total_stock_value,
                COALESCE(SUM(CASE
                    WHEN quantity <= low_stock_threshold THEN 1 ELSE 0
                END), 0) AS low_stock_count
            FROM products
            """
        ).fetchone()
    result = dict(row)
    result["total_stock_value"] = round(float(result["total_stock_value"]), 2)
    return jsonify(result)


@app.get(f"{API_PREFIX}/activity")
def recent_activity():
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT movements.id, movements.product_id, products.name AS product_name,
                   movements.movement_type AS type, movements.quantity, movements.note,
                   movements.created_at
            FROM stock_movements AS movements
            JOIN products ON products.id = movements.product_id
            ORDER BY movements.id DESC
            LIMIT 8
            """
        ).fetchall()
    return jsonify({"activities": [dict(row) for row in rows]})


if __name__ == "__main__":
    initialize_database()
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port, debug=False)
