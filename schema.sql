-- Vehicle Service Reminder System - MySQL schema (v1)
CREATE DATABASE IF NOT EXISTS vehicle_service
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE vehicle_service;

-- Login accounts: drivers (app) and mechanic staff (dashboard)
CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(100) NOT NULL,
  phone         VARCHAR(20)  NOT NULL UNIQUE,
  email         VARCHAR(120) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('driver','mechanic') NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Mechanic shops / garages
CREATE TABLE shops (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  owner_user_id INT NOT NULL,
  name          VARCHAR(120) NOT NULL,
  phone         VARCHAR(20),
  address       VARCHAR(255),
  latitude      DECIMAL(9,6) NOT NULL,
  longitude     DECIMAL(9,6) NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

-- Customers: app users AND walk-ins. user_id is NULL until they join the app.
CREATE TABLE customers (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  user_id   INT NULL UNIQUE,
  full_name VARCHAR(100) NOT NULL,
  phone     VARCHAR(20)  NOT NULL UNIQUE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE vehicles (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  plate       VARCHAR(15) NOT NULL UNIQUE,
  make        VARCHAR(50),
  model       VARCHAR(50),
  year        SMALLINT,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- One row per visit to a shop; odometer here is the mileage source
CREATE TABLE visits (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id        INT NOT NULL,
  shop_id           INT NOT NULL,
  visit_date        DATE NOT NULL,
  odometer_km       INT NOT NULL,
  summary           VARCHAR(255),
  next_service_km   INT,
  next_service_date DATE,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (shop_id)    REFERENCES shops(id),
  INDEX idx_vehicle_date (vehicle_id, visit_date)
);

-- Detailed records: work done and parts changed in a visit
CREATE TABLE visit_items (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  visit_id    INT NOT NULL,
  item_type   ENUM('work','part_replaced') NOT NULL,
  description VARCHAR(255) NOT NULL,
  quantity    INT DEFAULT 1,
  cost        DECIMAL(10,2),
  FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE CASCADE
);

-- Static glossary of dashboard warning lights
CREATE TABLE warning_lights (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(80) NOT NULL,
  color        ENUM('red','amber','green','blue') NOT NULL,
  meaning      TEXT NOT NULL,
  severity     ENUM('info','caution','critical') NOT NULL,
  see_mechanic BOOLEAN NOT NULL DEFAULT FALSE,
  advice       VARCHAR(255),
  icon         VARCHAR(255)
);

-- Roadside help requests to the nearest shop
CREATE TABLE help_requests (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  vehicle_id  INT,
  shop_id     INT NOT NULL,
  latitude    DECIMAL(9,6) NOT NULL,
  longitude   DECIMAL(9,6) NOT NULL,
  issue       VARCHAR(255),
  status      ENUM('pending','accepted','completed','cancelled') DEFAULT 'pending',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (vehicle_id)  REFERENCES vehicles(id),
  FOREIGN KEY (shop_id)     REFERENCES shops(id)
);
