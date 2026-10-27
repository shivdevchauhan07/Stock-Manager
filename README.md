# Stockwise Inventory

A small inventory app for practicing Python, Flask, SQLite, and a web interface.
You can add and edit products, record stock received or sold, search the catalog,
and see low-stock alerts and inventory totals. Products can also be organized by
category and supplier, then searched or filtered by either value.

## Run it in Replit

The app has two parts. Replit starts both for the preview:

- **Web** displays the inventory dashboard.
- **API** runs the Python server and saves data in `backend/inventory.db`.

Open the Preview pane to use it. The first launch adds a few example products so
you can try the app right away. The database file is created automatically and
keeps changes between restarts.

## Run it on your own computer

You need Python 3.10 or newer and Node.js with pnpm.

1. Open a terminal in the project folder.
2. Install the Python package:

   ```bash
   python -m pip install -r artifacts/stockwise-inventory/requirements.txt
   ```

3. Start the Flask API in the first terminal:

   ```bash
   python artifacts/stockwise-inventory/backend/app.py
   ```

4. Open a second terminal in the project folder and install the web packages:

   ```bash
   pnpm install
   ```

5. Start the web app:

   ```bash
   pnpm --filter @workspace/stockwise-inventory run dev
   ```

The web app will print a local address in the terminal. Open that address in a
browser. The web app forwards `/stock-api` requests to the Flask server on port
8000.

## Project files

```text
artifacts/stockwise-inventory/
  backend/
    app.py          Flask routes and input checks
    database.py     SQLite tables, example data, and database helpers
  src/
    App.tsx         Inventory screen and interactions
    index.css       App colors and responsive styles
  requirements.txt  Python packages
README.md            Setup instructions and project guide
```

## Beginner notes

- A **product** stores its name, optional SKU, category, supplier, price, current
  quantity, and the quantity level that triggers a low-stock alert.
- Prices are displayed in Indian rupees (₹); the numeric price can be changed
  in the product form.
- A **stock movement** records stock being received or sold. Sales cannot exceed
  the quantity currently on hand.
- SQLite stores the data in one file: `artifacts/stockwise-inventory/backend/inventory.db`.
- `app.py` defines the web API. `database.py` creates and reads the SQLite tables.
- To change how many units trigger an alert, edit a product and change its
  low-stock level.
- Category and supplier are optional text fields that can be changed when
  editing a product. Use the product search to find either value, or choose a
  category or supplier filter above the product list.
- To start with an empty database, stop the app and delete
  `artifacts/stockwise-inventory/backend/inventory.db`. The next launch recreates
  the example products. This permanently removes the products and stock history
  stored in that file.
