USE speed_inventory_management;

INSERT INTO users (email, full_name, role, is_active, password_salt, password_hash)
VALUES
  ('admin@gmail.com', 'Admin', 'admin', TRUE, '0123456789abcdef0123456789abcdef', '6388feeac0c12a89f108ba073fb0d531ca474dbc23898e9512215aafaff79e08')
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  role = VALUES(role),
  is_active = VALUES(is_active),
  password_salt = VALUES(password_salt),
  password_hash = VALUES(password_hash);
