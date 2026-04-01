USE speed_inventory_management;

INSERT INTO users (email, full_name, role, is_active, password_salt, password_hash)
VALUES
  ('admin@gmail.com', 'Admin', 'admin', TRUE, '', '$2a$12$PbWf4UovuWL.gD5YI8xt5Om8JjdcN2VXeqaXrUcWe8Nrlu6gVmL8e')
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  role = VALUES(role),
  is_active = VALUES(is_active),
  password_salt = VALUES(password_salt),
  password_hash = VALUES(password_hash);
