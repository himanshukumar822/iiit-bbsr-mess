const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated, hasRole } = require('../middleware/auth');
const { getMealPrices } = require('../utils/wallet');
const {
  getISTDateString,
  getISTDayOfWeek,
  getCurrentMeal
} = require('../utils/time');

// All routes require authenticated admin or superadmin
router.use(isAuthenticated, hasRole('admin', 'superadmin'));

// 1. GET /students — list all students (with search by roll_no, name, hostel)
router.get('/students', async (req, res) => {
  try {
    const { search, roll_no, name, hostel } = req.query;

    let sql = `SELECT id, roll_no, name, email, hostel, room_no, is_active, created_at
               FROM users
               WHERE role = 'student'`;
    const params = [];

    if (search) {
      sql += ' AND (roll_no LIKE ? OR name LIKE ? OR hostel LIKE ?)';
      const searchPattern = `%${search.trim()}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }
    if (roll_no) {
      sql += ' AND roll_no LIKE ?';
      params.push(`%${roll_no.trim()}%`);
    }
    if (name) {
      sql += ' AND name LIKE ?';
      params.push(`%${name.trim()}%`);
    }
    if (hostel) {
      sql += ' AND hostel LIKE ?';
      params.push(`%${hostel.trim()}%`);
    }

    sql += ' ORDER BY roll_no ASC';

    const [rows] = await db.query(sql, params);
    return res.json({ success: true, students: rows });
  } catch (error) {
    console.error('Error fetching students:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching students', error: error.message });
  }
});

// GET /menu — return full weekly menu for admin management
router.get('/menu', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, day_of_week, meal_type, items, updated_at
       FROM menu
       ORDER BY FIELD(day_of_week, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'),
                FIELD(meal_type, 'breakfast','lunch','snacks','dinner')`
    );
    return res.json({ success: true, menu: rows });
  } catch (error) {
    console.error('Error fetching admin menu:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching menu', error: error.message });
  }
});

// 2. PUT /menu/:id — update a menu item
router.put('/menu/:id', async (req, res) => {
  try {
    const { items } = req.body;
    const menu_id = req.params.id;
    const admin_id = req.session.user.id;

    if (!items || !items.trim()) {
      return res.status(400).json({ success: false, message: 'items description is required' });
    }

    const [existing] = await db.query('SELECT id FROM menu WHERE id = ?', [menu_id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }

    await db.query(
      `UPDATE menu
       SET items = ?, updated_by = ?
       WHERE id = ?`,
      [items.trim(), admin_id, menu_id]
    );

    return res.json({ success: true, message: 'Menu item updated successfully' });
  } catch (error) {
    console.error('Error updating menu item:', error);
    return res.status(500).json({ success: false, message: 'Server error updating menu item', error: error.message });
  }
});

// 3. GET /payments/pending — list all pending payments with student info
router.get('/payments/pending', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.id, p.student_id, p.amount, p.method, p.screenshot_path, p.status, p.notes, p.created_at,
              u.roll_no, u.name AS student_name, u.email AS student_email, u.hostel, u.room_no,
              co.id AS order_id, co.start_date, co.end_date, co.meals_selected, co.includes_sunday, COALESCE(co.wallet_used, 0) AS wallet_used
       FROM payments p
       JOIN users u ON u.id = p.student_id
       LEFT JOIN coupon_orders co ON co.payment_id = p.id
       WHERE p.status = 'pending'
       ORDER BY p.created_at ASC`
    );

    return res.json({ success: true, pending_payments: rows });
  } catch (error) {
    console.error('Error fetching pending payments:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching pending payments', error: error.message });
  }
});

// 4. PUT /payments/:id/verify — approve or reject a payment
router.put('/payments/:id/verify', async (req, res) => {
  let conn;
  try {
    const payment_id = req.params.id;
    const { action, notes } = req.body;
    const admin_id = req.session.user.id;

    if (!action || !['verify', 'reject'].includes(action.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'Action must be either "verify" or "reject"'
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    const [payments] = await conn.query('SELECT * FROM payments WHERE id = ? FOR UPDATE', [payment_id]);
    if (payments.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Payment record not found' });
    }

    const payment = payments[0];
    if (payment.status !== 'pending') {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: `Payment #${payment_id} has already been processed with status '${payment.status}'. Re-processing is not allowed.`
      });
    }
    const isVerify = action.toLowerCase() === 'verify';
    const newStatus = isVerify ? 'verified' : 'rejected';

    // Update payment record
    await conn.query(
      `UPDATE payments
       SET status = ?, verified_by = ?, notes = COALESCE(?, notes)
       WHERE id = ?`,
      [newStatus, admin_id, notes || null, payment_id]
    );

    const [orders] = await conn.query(
      'SELECT * FROM coupon_orders WHERE payment_id = ?',
      [payment_id]
    );

    // If verified, generate individual coupons according to coupon_order
    if (isVerify && orders.length > 0) {
      const order = orders[0];
      let mealsSelected = order.meals_selected;
      if (typeof mealsSelected === 'string') {
        try {
          mealsSelected = JSON.parse(mealsSelected);
        } catch (e) {
          mealsSelected = {};
        }
      }

      const includesSunday = Boolean(order.includes_sunday);
      const startStr = order.start_date instanceof Date ? getISTDateString(order.start_date) : String(order.start_date).split('T')[0];
      const endStr = order.end_date instanceof Date ? getISTDateString(order.end_date) : String(order.end_date).split('T')[0];
      const current = new Date(`${startStr}T00:00:00+05:30`);
      const end = new Date(`${endStr}T00:00:00+05:30`);

      while (current <= end) {
        const dayName = getISTDayOfWeek(current);
        const dateStr = getISTDateString(current);

        if (dayName !== 'Sunday' || includesSunday) {
          const dayMeals = mealsSelected[dayName] || [];
          for (const meal of dayMeals) {
            await conn.query(
              `INSERT INTO coupons (student_id, meal_type, meal_date, source, status)
               VALUES (?, ?, ?, 'prepaid', 'active')
               ON DUPLICATE KEY UPDATE status = 'active'`,
              [order.student_id, meal.toLowerCase(), dateStr]
            );
          }
        }
        current.setUTCDate(current.getUTCDate() + 1);
      }
    }

    // If rejected and wallet balance had been deducted for this order, refund it back
    if (!isVerify && orders.length > 0) {
      const order = orders[0];
      const walletUsed = parseFloat(order.wallet_used) || 0;
      if (walletUsed > 0) {
        await conn.query(
          'UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + ? WHERE id = ?',
          [walletUsed, order.student_id]
        );
        await conn.query(
          `INSERT INTO wallet_transactions (student_id, amount, type, reason, reference_id)
           VALUES (?, ?, 'credit', ?, ?)`,
          [order.student_id, walletUsed, `Refunded wallet credit from rejected Order #${order.id}`, order.id]
        );
      }
    }

    await conn.commit();

    return res.json({
      success: true,
      message: `Payment has been ${isVerify ? 'verified and coupons generated successfully' : 'rejected'}`
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error('Error verifying payment:', error);
    return res.status(500).json({ success: false, message: 'Server error verifying payment', error: error.message });
  } finally {
    if (conn) conn.release();
  }
});

// 5. GET /claims/today — show all students with active coupons for today's current meal
router.get('/claims/today', async (req, res) => {
  try {
    const todayIST = getISTDateString();
    const mealType = (req.query.meal_type || getCurrentMeal()).toLowerCase();

    const [rows] = await db.query(
      `SELECT c.id AS coupon_id, c.student_id, c.meal_type, c.meal_date, c.source, c.status, c.created_at,
              u.roll_no, u.name AS student_name, u.hostel, u.room_no
       FROM coupons c
       JOIN users u ON u.id = c.student_id
       WHERE c.meal_date = ? AND c.meal_type = ? AND c.status = 'active'
       ORDER BY u.roll_no ASC`,
      [todayIST, mealType]
    );

    return res.json({
      success: true,
      date: todayIST,
      meal_type: mealType,
      active_claims: rows
    });
  } catch (error) {
    console.error('Error fetching today claims:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching claims', error: error.message });
  }
});

// 6. POST /claims/:coupon_id — mark a coupon as "used" (claimed)
router.post('/claims/:coupon_id', async (req, res) => {
  try {
    const coupon_id = req.params.coupon_id;

    const [coupons] = await db.query(
      'SELECT id, status, meal_type, meal_date FROM coupons WHERE id = ?',
      [coupon_id]
    );

    if (coupons.length === 0) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }

    const coupon = coupons[0];
    if (coupon.status === 'used') {
      return res.status(400).json({ success: false, message: 'Coupon has already been claimed' });
    }

    if (coupon.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: `Cannot claim coupon with status '${coupon.status}'`
      });
    }

    await db.query(
      `UPDATE coupons
       SET status = 'used', claimed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [coupon_id]
    );

    return res.json({
      success: true,
      message: 'Coupon claimed successfully',
      coupon_id
    });
  } catch (error) {
    console.error('Error claiming coupon:', error);
    return res.status(500).json({ success: false, message: 'Server error claiming coupon', error: error.message });
  }
});

// 7. POST /spot-coupon — issue spot coupon for walk-in
router.post('/spot-coupon', async (req, res) => {
  try {
    const { student_roll_no, meal_type } = req.body;
    const admin_id = req.session.user.id;

    if (!student_roll_no || !meal_type) {
      return res.status(400).json({
        success: false,
        message: 'student_roll_no and meal_type are required'
      });
    }

    const ROLL_NO_REGEX = /^[A-Za-z0-9_-]{4,20}$/;
    if (!ROLL_NO_REGEX.test(student_roll_no.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid roll number format. Must be 4-20 alphanumeric characters'
      });
    }

    const mealTypeLower = meal_type.toLowerCase();
    const validMeals = ['breakfast', 'lunch', 'snacks', 'dinner'];
    if (!validMeals.includes(mealTypeLower)) {
      return res.status(400).json({
        success: false,
        message: `Invalid meal_type. Must be one of: ${validMeals.join(', ')}`
      });
    }

    // Find student by roll_no
    const [students] = await db.query(
      'SELECT id, roll_no, name, hostel, room_no FROM users WHERE roll_no = ? AND role = "student"',
      [student_roll_no.trim()]
    );

    if (students.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Student with roll_no '${student_roll_no}' not found`
      });
    }

    const student = students[0];
    const todayIST = getISTDateString();

    // Get price from mess_settings
    const [priceRows] = await db.query(
      'SELECT setting_value FROM mess_settings WHERE setting_key = ?',
      [`${mealTypeLower}_price`]
    );
    const defaultPrices = { breakfast: 30, lunch: 50, snacks: 15, dinner: 50 };
    const price = priceRows.length > 0 ? parseFloat(priceRows[0].setting_value) : defaultPrices[mealTypeLower];

    // 1. Create verified cash payment record
    await db.query(
      `INSERT INTO payments (student_id, amount, method, status, verified_by, notes)
       VALUES (?, ?, 'cash', 'verified', ?, 'Spot meal walk-in purchase')`,
      [student.id, price, admin_id]
    );

    // 2. Create coupon with source='spot', status='used'
    await db.query(
      `INSERT INTO coupons (student_id, meal_type, meal_date, source, status, claimed_at)
       VALUES (?, ?, ?, 'spot', 'used', CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE source = 'spot', status = 'used', claimed_at = CURRENT_TIMESTAMP`,
      [student.id, mealTypeLower, todayIST]
    );

    return res.status(201).json({
      success: true,
      message: 'Spot coupon issued and claimed successfully',
      student: {
        id: student.id,
        roll_no: student.roll_no,
        name: student.name
      },
      meal_type: mealTypeLower,
      meal_date: todayIST,
      amount: price
    });
  } catch (error) {
    console.error('Error issuing spot coupon:', error);
    return res.status(500).json({ success: false, message: 'Server error issuing spot coupon', error: error.message });
  }
});

// 8. GET /complaints — view all complaints (with filters: ?status=open&date=2026-11-09)
router.get('/complaints', async (req, res) => {
  try {
    const { status, date } = req.query;

    let sql = `SELECT c.id, c.student_id, c.meal_date, c.meal_type, c.category, c.description, c.status,
                      c.response, c.responded_by, c.resolved_at, c.created_at,
                      u.roll_no AS student_roll_no, u.name AS student_name, u.hostel, u.room_no,
                      r.name AS responded_by_name
               FROM complaints c
               JOIN users u ON u.id = c.student_id
               LEFT JOIN users r ON r.id = c.responded_by
               WHERE 1=1`;
    const params = [];

    if (status) {
      sql += ' AND c.status = ?';
      params.push(status);
    }
    if (date) {
      sql += ' AND c.meal_date = ?';
      params.push(date);
    }

    sql += ' ORDER BY c.created_at DESC';

    const [rows] = await db.query(sql, params);
    return res.json({ success: true, complaints: rows });
  } catch (error) {
    console.error('Error fetching complaints:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching complaints', error: error.message });
  }
});

// 9. PUT /complaints/:id — respond to complaint
router.put('/complaints/:id', async (req, res) => {
  try {
    const complaint_id = req.params.id;
    const { response, status } = req.body;
    const admin_id = req.session.user.id;

    if (!response || !response.trim()) {
      return res.status(400).json({ success: false, message: 'Response message is required' });
    }

    const nextStatus = status ? status.toLowerCase() : 'resolved';
    if (!['in_progress', 'resolved'].includes(nextStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either "in_progress" or "resolved"'
      });
    }

    const [existing] = await db.query('SELECT id FROM complaints WHERE id = ?', [complaint_id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    await db.query(
      `UPDATE complaints
       SET response = ?,
           status = ?,
           responded_by = ?,
           resolved_at = CASE WHEN ? = 'resolved' THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = ?`,
      [response.trim(), nextStatus, admin_id, nextStatus, complaint_id]
    );

    return res.json({
      success: true,
      message: 'Complaint response recorded successfully',
      status: nextStatus
    });
  } catch (error) {
    console.error('Error responding to complaint:', error);
    return res.status(500).json({ success: false, message: 'Server error responding to complaint', error: error.message });
  }
});

// 10. GET /leave/pending — view pending leave requests
router.get('/leave/pending', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT l.id, l.student_id, l.start_date, l.end_date, l.reason, l.status, l.created_at,
              u.roll_no AS student_roll_no, u.name AS student_name, u.hostel, u.room_no
       FROM mess_leave l
       JOIN users u ON u.id = l.student_id
       WHERE l.status = 'pending'
       ORDER BY l.created_at ASC`
    );

    return res.json({ success: true, pending_leaves: rows });
  } catch (error) {
    console.error('Error fetching pending leaves:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching pending leaves', error: error.message });
  }
});

// 11. PUT /leave/:id — approve/reject leave and refund unused future meal costs to student's Mess Wallet
router.put('/leave/:id', async (req, res) => {
  let conn;
  try {
    const leave_id = req.params.id;
    const { action } = req.body;
    const admin_id = req.session.user.id;

    if (!action || !['approve', 'reject'].includes(action.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'Action must be either "approve" or "reject"'
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    const [leaves] = await conn.query('SELECT * FROM mess_leave WHERE id = ? FOR UPDATE', [leave_id]);
    if (leaves.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Leave request not found' });
    }

    const leave = leaves[0];
    if (leave.status !== 'pending') {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: `Leave request #${leave_id} has already been ${leave.status}.`
      });
    }

    const isApprove = action.toLowerCase() === 'approve';
    const newStatus = isApprove ? 'approved' : 'rejected';

    await conn.query(
      `UPDATE mess_leave
       SET status = ?, approved_by = ?
       WHERE id = ?`,
      [newStatus, admin_id, leave_id]
    );

    let refundedAmount = 0;
    let couponsUpdated = 0;

    // If approved: mark future active coupons in range as 'on_leave' and credit their price to student's wallet
    if (isApprove) {
      const todayIST = getISTDateString();
      const startDateStr = leave.start_date instanceof Date ? getISTDateString(leave.start_date) : String(leave.start_date).split('T')[0];
      const endDateStr = leave.end_date instanceof Date ? getISTDateString(leave.end_date) : String(leave.end_date).split('T')[0];

      const [eligibleCoupons] = await conn.query(
        `SELECT id, meal_type, meal_date
         FROM coupons
         WHERE student_id = ? AND meal_date > ? AND meal_date >= ? AND meal_date <= ? AND status = 'active' FOR UPDATE`,
        [leave.student_id, todayIST, startDateStr, endDateStr]
      );

      if (eligibleCoupons.length > 0) {
        const prices = await getMealPrices(conn);
        for (const c of eligibleCoupons) {
          refundedAmount += prices[c.meal_type.toLowerCase()] || 0;
        }
        const ids = eligibleCoupons.map(c => c.id);
        const placeholders = ids.map(() => '?').join(',');
        await conn.query(
          `UPDATE coupons SET status = 'on_leave' WHERE id IN (${placeholders})`,
          ids
        );
        couponsUpdated = eligibleCoupons.length;

        if (refundedAmount > 0) {
          await conn.query(
            `UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + ? WHERE id = ?`,
            [refundedAmount, leave.student_id]
          );
          await conn.query(
            `INSERT INTO wallet_transactions (student_id, amount, type, reason, reference_id)
             VALUES (?, ?, 'credit', ?, ?)`,
            [leave.student_id, refundedAmount, `Approved Leave (${startDateStr} to ${endDateStr}) - ${couponsUpdated} meal(s)`, leave.id]
          );
        }
      }
    }

    await conn.commit();

    return res.json({
      success: true,
      message: isApprove
        ? `Leave approved! ${couponsUpdated} meal(s) marked on_leave and ₹${refundedAmount.toFixed(2)} credited to student's Mess Wallet.`
        : 'Leave request rejected',
      coupons_updated: couponsUpdated,
      refunded_amount: refundedAmount
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error('Error approving/rejecting leave:', error);
    return res.status(500).json({ success: false, message: 'Server error updating leave', error: error.message });
  } finally {
    if (conn) conn.release();
  }
});

// 12. GET /dashboard/stats — today's stats
router.get('/dashboard/stats', async (req, res) => {
  try {
    const todayIST = getISTDateString();

    // Meals served per type today
    const [servedRows] = await db.query(
      `SELECT meal_type, COUNT(*) AS count
       FROM coupons
       WHERE meal_date = ? AND status = 'used'
       GROUP BY meal_type`,
      [todayIST]
    );

    const meals_served = { breakfast: 0, lunch: 0, snacks: 0, dinner: 0 };
    servedRows.forEach(row => {
      if (meals_served.hasOwnProperty(row.meal_type)) {
        meals_served[row.meal_type] = row.count;
      }
    });

    // Total active students
    const [studentCountRows] = await db.query(
      `SELECT COUNT(*) AS count FROM users WHERE role = 'student' AND is_active = TRUE`
    );

    // Pending payments
    const [pendingPaymentRows] = await db.query(
      `SELECT COUNT(*) AS count FROM payments WHERE status = 'pending'`
    );

    // Open complaints
    const [openComplaintRows] = await db.query(
      `SELECT COUNT(*) AS count FROM complaints WHERE status = 'open'`
    );

    return res.json({
      success: true,
      date: todayIST,
      stats: {
        meals_served,
        total_students: studentCountRows[0].count,
        pending_payments: pendingPaymentRows[0].count,
        open_complaints: openComplaintRows[0].count
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching dashboard stats', error: error.message });
  }
});

// 13. GET /reports/daily — return or generate daily report for a given date
router.get('/reports/daily', async (req, res) => {
  try {
    const targetDate = req.query.date || getISTDateString();

    // 1. Count coupons used per meal type
    const [usedCoupons] = await db.query(
      `SELECT meal_type, COUNT(*) AS count
       FROM coupons
       WHERE meal_date = ? AND status = 'used'
       GROUP BY meal_type`,
      [targetDate]
    );

    let total_breakfast = 0;
    let total_lunch = 0;
    let total_snacks = 0;
    let total_dinner = 0;

    usedCoupons.forEach(r => {
      if (r.meal_type === 'breakfast') total_breakfast = r.count;
      if (r.meal_type === 'lunch') total_lunch = r.count;
      if (r.meal_type === 'snacks') total_snacks = r.count;
      if (r.meal_type === 'dinner') total_dinner = r.count;
    });

    // 2. Count skips
    const [skipRows] = await db.query(
      `SELECT COUNT(*) AS count FROM coupons WHERE meal_date = ? AND status = 'skipped'`,
      [targetDate]
    );
    const total_skips = skipRows[0].count;

    // 3. Count spots
    const [spotRows] = await db.query(
      `SELECT COUNT(*) AS count FROM coupons WHERE meal_date = ? AND source = 'spot'`,
      [targetDate]
    );
    const total_spot = spotRows[0].count;

    // 4. Count complaints and resolved complaints
    const [complaintRows] = await db.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved
       FROM complaints
       WHERE meal_date = ?`,
      [targetDate]
    );
    const total_complaints = complaintRows[0].total || 0;
    const complaints_resolved = complaintRows[0].resolved || 0;

    // 5. Sum payments verified that day
    const [revenueRows] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS revenue
       FROM payments
       WHERE status = 'verified' AND DATE(created_at) = ?`,
      [targetDate]
    );
    const revenue = parseFloat(revenueRows[0].revenue) || 0;

    // Insert or update into daily_reports table
    await db.query(
      `INSERT INTO daily_reports (
         report_date, total_breakfast, total_lunch, total_snacks, total_dinner,
         total_skips, total_spot, total_complaints, complaints_resolved, revenue
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         total_breakfast = VALUES(total_breakfast),
         total_lunch = VALUES(total_lunch),
         total_snacks = VALUES(total_snacks),
         total_dinner = VALUES(total_dinner),
         total_skips = VALUES(total_skips),
         total_spot = VALUES(total_spot),
         total_complaints = VALUES(total_complaints),
         complaints_resolved = VALUES(complaints_resolved),
         revenue = VALUES(revenue),
         generated_at = CURRENT_TIMESTAMP`,
      [
        targetDate,
        total_breakfast,
        total_lunch,
        total_snacks,
        total_dinner,
        total_skips,
        total_spot,
        total_complaints,
        complaints_resolved,
        revenue
      ]
    );

    const [reportRows] = await db.query(
      'SELECT * FROM daily_reports WHERE report_date = ?',
      [targetDate]
    );

    return res.json({
      success: true,
      report: reportRows[0]
    });
  } catch (error) {
    console.error('Error generating daily report:', error);
    return res.status(500).json({ success: false, message: 'Server error generating daily report', error: error.message });
  }
});

// 14. POST /coupons/expire-past — manually or periodically trigger expiration of past active coupons
router.post('/coupons/expire-past', async (req, res) => {
  try {
    const todayIST = getISTDateString();
    const [result] = await db.query(
      `UPDATE coupons
       SET status = 'expired'
       WHERE meal_date < ? AND status = 'active'`,
      [todayIST]
    );

    return res.json({
      success: true,
      message: `Expired ${result.affectedRows} past active coupon(s)`,
      expired_count: result.affectedRows
    });
  } catch (error) {
    console.error('Error expiring past coupons:', error);
    return res.status(500).json({ success: false, message: 'Server error expiring coupons', error: error.message });
  }
});

module.exports = router;
