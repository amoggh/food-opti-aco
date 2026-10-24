# Backend Data

This directory stores datasets utilized for road networks, customer orders, restaurant locations, and traffic conditions.

## Directory Structure
- **`raw/`**: Contains original, immutable datasets generated for the simulation environment.
  - `restaurants.csv`: Restaurant metadata and location coordinates.
  - `customers.csv`: Customer IDs, names, and delivery locations.
  - `orders.csv`: Delivery orders with preparation times, deadlines, and statuses.
  - `riders.csv`: Delivery couriers, starting coordinates, bag capacities, and availability.
- **`processed/`**: Will contain cleaned, normalized, and graph-projected datasets prepared during Phase 2 for routing and optimization.

---

## Dataset Schema & Data Dictionary

### 1. `restaurants.csv`
| Column | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `restaurant_id` | String (Primary Key) | Unique restaurant identifier | `REST_001` |
| `latitude` | Float | Geographic latitude coordinate | `12.980545` |
| `longitude` | Float | Geographic longitude coordinate | `77.600879` |
| `name` | String | Commercial business name | `Flavors of Grill` |
| `average_preparation_time` | Integer | Average kitchen meal preparation time in minutes | `13` |

### 2. `customers.csv`
| Column | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `customer_id` | String (Primary Key) | Unique customer identifier | `CUST_0001` |
| `latitude` | Float | Customer delivery destination latitude | `12.945781` |
| `longitude` | Float | Customer delivery destination longitude | `77.652175` |
| `name` | String | Customer full name | `Riya Gupta` |

### 3. `orders.csv`
| Column | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `order_id` | String (Primary Key) | Unique order identifier, sorted chronologically | `ORD_0001` |
| `restaurant_id` | String (Foreign Key) | Reference to pickup restaurant (`restaurants.csv`) | `REST_010` |
| `customer_id` | String (Foreign Key) | Reference to dropoff customer (`customers.csv`) | `CUST_0116` |
| `order_time` | Timestamp (`YYYY-MM-DD HH:MM:SS`) | Time when the customer placed the order | `2026-10-01 12:03:57` |
| `preparation_time` | Integer | Kitchen preparation time in minutes ($>0$) | `19` |
| `deadline` | Timestamp (`YYYY-MM-DD HH:MM:SS`) | Guaranteed delivery deadline ($\ge \text{order\_time} + \text{prep\_time}$) | `2026-10-01 12:43:57` |
| `order_status` | String | Current order lifecycle status | `PENDING` |

### 4. `riders.csv`
| Column | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `rider_id` | String (Primary Key) | Unique courier identifier | `RIDER_001` |
| `latitude` | Float | Initial courier spatial latitude | `12.932843` |
| `longitude` | Float | Initial courier spatial longitude | `77.609647` |
| `capacity` | Integer | Maximum simultaneous order carrying capacity | `2` |
| `status` | String | Courier availability status | `AVAILABLE` |

---

## City & Spatial Distribution Model

The synthetic generator replicates realistic urban geography rather than uniform noise:
1. **Commercial Food Hubs**: Restaurants are clustered around designated commercial districts (Downtown Food Square, Tech Park Dine Hub, Northside Shopping District, Eastside Gourmet Lane) using 2D Gaussian kernels.
2. **Residential Zones**: Customers are distributed predominantly across residential neighborhoods and apartment clusters, with a background citywide dispersion.
3. **Rider Deployment**: Riders are positioned around commercial centers and active restaurant hubs where couriers naturally stage for dispatches.
4. **Reproducibility**: Configured via `random_seed` in `backend/config/data_config.py` (default: `42`).

---

## Running Generator and Validator

### Generating Synthetic Datasets
```bash
python -m backend.data.generator --output-dir backend/data/raw --seed 42 --restaurants 25 --customers 120 --orders 150 --riders 20
```

### Validating Datasets
```bash
python -m backend.data.validator --data-dir backend/data/raw
```

### Running Test Suite
```bash
python -m pytest backend/tests/test_data_generation.py -v
```
