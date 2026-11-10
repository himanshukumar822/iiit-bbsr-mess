-- IIIT Bhubaneswar Mess Management System Database Schema
-- Database: iiit_mess

CREATE DATABASE IF NOT EXISTS `iiit_mess`;
USE `iiit_mess`;

-- 1. users table
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `roll_no` VARCHAR(20) UNIQUE NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(100) UNIQUE NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `hostel` VARCHAR(50) NOT NULL,
  `room_no` VARCHAR(10) NULL,
  `role` ENUM('student', 'admin', 'superadmin') DEFAULT 'student',
  `wallet_balance` DECIMAL(10,2) DEFAULT 0.00,
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. menu table
CREATE TABLE IF NOT EXISTS `menu` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `day_of_week` ENUM('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') NOT NULL,
  `meal_type` ENUM('breakfast','lunch','snacks','dinner') NOT NULL,
  `items` TEXT NOT NULL,
  `updated_by` INT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_day_meal` (`day_of_week`, `meal_type`),
  FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. mess_settings table
CREATE TABLE IF NOT EXISTS `mess_settings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `setting_key` VARCHAR(50) UNIQUE NOT NULL,
  `setting_value` TEXT NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. coupons table
CREATE TABLE IF NOT EXISTS `coupons` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `meal_type` ENUM('breakfast','lunch','snacks','dinner') NOT NULL,
  `meal_date` DATE NOT NULL,
  `source` ENUM('prepaid','spot','sunday') DEFAULT 'prepaid',
  `status` ENUM('active','used','skipped','on_leave','expired') DEFAULT 'active',
  `claimed_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_student_meal_date` (`student_id`, `meal_type`, `meal_date`),
  INDEX `idx_meal_date_status` (`meal_date`, `status`),
  FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. payments table
CREATE TABLE IF NOT EXISTS `payments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `method` ENUM('cash','online') NOT NULL,
  `screenshot_path` MEDIUMTEXT NULL,
  `status` ENUM('pending','verified','rejected') DEFAULT 'pending',
  `verified_by` INT NULL,
  `notes` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. coupon_orders table
CREATE TABLE IF NOT EXISTS `coupon_orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `payment_id` INT NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `meals_selected` JSON NOT NULL,
  `includes_sunday` BOOLEAN DEFAULT FALSE,
  `wallet_used` DECIMAL(10,2) DEFAULT 0.00,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. mess_leave table
CREATE TABLE IF NOT EXISTS `mess_leave` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `reason` TEXT NULL,
  `status` ENUM('pending','approved','rejected') DEFAULT 'pending',
  `approved_by` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `chk_leave_dates` CHECK (`end_date` >= `start_date`),
  FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. complaints table
CREATE TABLE IF NOT EXISTS `complaints` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `meal_date` DATE NOT NULL,
  `meal_type` ENUM('breakfast','lunch','snacks','dinner') NOT NULL,
  `category` ENUM('food_quality','hygiene','quantity','staff_behavior','other') NOT NULL,
  `description` TEXT NOT NULL,
  `status` ENUM('open','in_progress','resolved') DEFAULT 'open',
  `response` TEXT NULL,
  `responded_by` INT NULL,
  `resolved_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_complaints_meal_date_status` (`meal_date`, `status`),
  FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`responded_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. daily_reports table
CREATE TABLE IF NOT EXISTS `daily_reports` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `report_date` DATE UNIQUE NOT NULL,
  `total_breakfast` INT DEFAULT 0,
  `total_lunch` INT DEFAULT 0,
  `total_snacks` INT DEFAULT 0,
  `total_dinner` INT DEFAULT 0,
  `total_skips` INT DEFAULT 0,
  `total_spot` INT DEFAULT 0,
  `total_complaints` INT DEFAULT 0,
  `complaints_resolved` INT DEFAULT 0,
  `revenue` DECIMAL(10,2) DEFAULT 0.00,
  `generated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. wallet_transactions table
CREATE TABLE IF NOT EXISTS `wallet_transactions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `type` ENUM('credit', 'debit') NOT NULL,
  `reason` VARCHAR(255) NOT NULL,
  `reference_id` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_wallet_student_created` (`student_id`, `created_at`),
  FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. sessions table (persistent session store for serverless/Vercel)
CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id` VARCHAR(128) NOT NULL PRIMARY KEY,
  `expires` BIGINT UNSIGNED NOT NULL,
  `data` MEDIUMTEXT NULL,
  INDEX `idx_sessions_expires` (`expires`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================
-- SEED DATA
-- ==========================================

-- Seed Super Admin (password: admin123)
INSERT INTO `users` (`id`, `roll_no`, `name`, `email`, `password_hash`, `hostel`, `room_no`, `role`, `is_active`)
VALUES (1, 'ADMIN001', 'Dean Student Affairs', 'dean@iiitbbsr.ac.in', '$2a$10$WlDsm92XiRGyolsVk8ljrOkRIcY7yDGfyVzNhu034Ij9pIHSFNsUO', 'Admin Block', 'DO-01', 'superadmin', TRUE)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- Seed Mess Settings
INSERT INTO `mess_settings` (`setting_key`, `setting_value`) VALUES
('breakfast_price', '30'),
('lunch_price', '50'),
('snacks_price', '15'),
('dinner_price', '50'),
('sunday_opt_in', 'true'),
('skip_cutoff_minutes', '60')
ON DUPLICATE KEY UPDATE `setting_value` = VALUES(`setting_value`);

-- Seed Menu
INSERT INTO `menu` (`day_of_week`, `meal_type`, `items`, `updated_by`) VALUES
-- Monday
('Monday', 'breakfast', 'Poha, Boiled Egg, Bread-Butter, Tea/Milk', 1),
('Monday', 'lunch', 'Rice, Dal Tadka, Aloo Gobi, Roti, Salad', 1),
('Monday', 'snacks', 'Samosa, Tea', 1),
('Monday', 'dinner', 'Rice, Paneer Butter Masala, Roti, Dal', 1),

-- Tuesday
('Tuesday', 'breakfast', 'Idli-Sambhar, Banana, Tea/Milk', 1),
('Tuesday', 'lunch', 'Rice, Rajma, Bhindi Fry, Roti, Salad', 1),
('Tuesday', 'snacks', 'Bread Pakora, Tea', 1),
('Tuesday', 'dinner', 'Rice, Egg Curry, Roti, Dal Fry', 1),

-- Wednesday
('Wednesday', 'breakfast', 'Paratha (Aloo), Curd, Tea/Milk', 1),
('Wednesday', 'lunch', 'Rice, Chole, Cabbage Sabzi, Roti, Salad', 1),
('Wednesday', 'snacks', 'Biscuit, Tea', 1),
('Wednesday', 'dinner', 'Rice, Chicken Curry / Soya Chunk, Roti, Dal', 1),

-- Thursday
('Thursday', 'breakfast', 'Puri-Sabzi, Boiled Egg, Tea/Milk', 1),
('Thursday', 'lunch', 'Rice, Dal Palak, Aloo Matar, Roti, Salad', 1),
('Thursday', 'snacks', 'Veg Cutlet, Tea', 1),
('Thursday', 'dinner', 'Rice, Fish Curry / Paneer Curry, Roti, Dal', 1),

-- Friday
('Friday', 'breakfast', 'Upma, Banana, Tea/Milk', 1),
('Friday', 'lunch', 'Rice, Sambar, Baingan Bharta, Roti, Salad', 1),
('Friday', 'snacks', 'Pakora, Tea', 1),
('Friday', 'dinner', 'Biryani (Veg/Non-Veg), Raita, Dal', 1),

-- Saturday
('Saturday', 'breakfast', 'Chhole Bhature, Tea/Milk', 1),
('Saturday', 'lunch', 'Rice, Yellow Dal, Mix Veg, Roti, Salad', 1),
('Saturday', 'snacks', 'Cake/Pastry, Tea', 1),
('Saturday', 'dinner', 'Rice, Mutton / Mushroom Curry, Roti, Dal', 1),

-- Sunday
('Sunday', 'breakfast', 'Aloo Paratha, Curd, Tea/Milk', 1),
('Sunday', 'lunch', 'Rice, Chicken/Paneer Kofta, Roti, Salad', 1),
('Sunday', 'snacks', 'Maggi, Tea', 1),
('Sunday', 'dinner', 'Khichdi, Papad, Pickle, Curd', 1)
ON DUPLICATE KEY UPDATE `items` = VALUES(`items`), `updated_by` = VALUES(`updated_by`);
