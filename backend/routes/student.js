const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated, hasRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getMealPrices } = require('../utils/wallet');
const {
  getISTDateString,
  getISTDayOfWeek,
  isWithinMealWindow,
  MEAL_WINDOWS
} = require('../utils/time');

// All routes require authenticated student
router.use(isAuthenticated, hasRole('student'));

// 1. GET /menu — return full weekly menu from menu table
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
    console.error('Error fetching menu:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching menu', error: error.message });
  }
});

// 2. GET /menu/today — return today's menu (based on day of week)
router.get('/menu/today', async (req, res) => {
  try {
    const todayDay = getISTDayOfWeek();
    const [rows] = await db.query(
      `SELECT id, day_of_week, meal_type, items, updated_at
       FROM menu
       WHERE day_of_week = ?
       ORDER BY FIELD(meal_type, 'breakfast','lunch','snacks','dinner')`,
      [todayDay]
    );
    return res.json({ success: true, day_of_week: todayDay, menu: rows });
  } catch (error) {
    console.error('Error fetching today menu:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching today menu', error: error.message });
  }
});

// 3. POST /coupons/buy — Buy coupons for a date range (supports optional Mess Wallet credit usage)
router.post('/coupons/buy', upload.single('screenshot'), async (req, res) => {
  let conn;
  try {
    const student_id = req.session.user.id;
    const { start_date, end_date, payment_method } = req.body;
    let meals_selected = req.body.meals_selected;
    const includes_sunday = req.body.includes_sunday === true || req.body.includes_sunday === 'true';
    const use_wallet = req.body.use_wallet === true || req.body.use_wallet === 'true';

    if (!start_date || !end_date || !meals_selected || !payment_method) {
      return res.status(400).json({
        success: false,
        message: 'start_date, end_date, meals_selected, and payment_method are required'
      });
    }

    const todayIST = getISTDateString();
    if (start_date < todayIST) {
      return res.status(400).json({
        success: false,
        message: 'Start date cannot be in the past'
      });
    }

    if (end_date < start_date) {
      return res.status(400).json({
        success: false,
        message: 'end_date must be greater than or equal to start_date'
      });
    }

    const method = payment_method.toLowerCase();
    if (!['cash', 'online'].includes(method)) {
      return res.status(400).json({
        success: false,
        message: 'payment_method must be either cash or online'
      });
    }

    // Parse meals_selected if passed as string
    if (typeof meals_selected === 'string') {
      try {
        meals_selected = JSON.parse(meals_selected);
      } catch (err) {
        return res.status(400).json({
          success: false,
          message: 'Invalid JSON format for meals_selected'
        });
      }
    }

    // Check if at least one meal is selected across all days
    const totalSelected = Object.values(meals_selected).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
    if (totalSelected === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one meal must be selected'
      });
    }

    // Guardrail: Check for overlapping/duplicate active or pending coupon orders
    const [overlapOrders] = await db.query(
      `SELECT co.id, co.start_date, co.end_date
       FROM coupon_orders co
       JOIN payments p ON p.id = co.payment_id
       WHERE co.student_id = ?
         AND p.status IN ('pending', 'verified')
         AND NOT (co.end_date < ? OR co.start_date > ?)`,
      [student_id, start_date, end_date]
    );

    if (overlapOrders.length > 0) {
      const conflict = overlapOrders[0];
      const cStart = conflict.start_date instanceof Date ? getISTDateString(conflict.start_date) : String(conflict.start_date).split('T')[0];
      const cEnd = conflict.end_date instanceof Date ? getISTDateString(conflict.end_date) : String(conflict.end_date).split('T')[0];
      return res.status(400).json({
        success: false,
        message: `You already have an active/pending coupon order overlapping this period (${cStart} to ${cEnd})`
      });
    }

    let screenshot_path = null;
    if (method === 'online') {
      if (req.file) {
        if (req.file.buffer) {
          screenshot_path = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        } else if (req.file.filename) {
          screenshot_path = `/uploads/${req.file.filename}`;
        }
      } else if (req.body.screenshot_path) {
        screenshot_path = req.body.screenshot_path;
      }
    }

    // Fetch meal prices from mess_settings & calculate total meal value
    const prices = await getMealPrices(db);
    let calculatedAmount = 0;
    const datesToGenerate = [];

    const current = new Date(`${start_date}T00:00:00+05:30`);
    const end = new Date(`${end_date}T00:00:00+05:30`);

    while (current <= end) {
      const dayName = getISTDayOfWeek(current);
      const dateStr = getISTDateString(current);
      if (dayName !== 'Sunday' || includes_sunday) {
        const dayMeals = meals_selected[dayName] || [];
        for (const meal of dayMeals) {
          const mealLower = meal.toLowerCase();
          calculatedAmount += prices[mealLower] || 0;
          datesToGenerate.push({ meal: mealLower, dateStr });
        }
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }

    if (datesToGenerate.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No meals fall within the selected date range'
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    // Check and apply wallet balance if requested
    let walletUsed = 0;
    let payableAmount = calculatedAmount;

    const [userRows] = await conn.query(
      'SELECT COALESCE(wallet_balance, 0) AS wallet_balance FROM users WHERE id = ? FOR UPDATE',
      [student_id]
    );
    const currentWallet = parseFloat(userRows[0]?.wallet_balance) || 0;

    if (use_wallet && currentWallet > 0) {
      walletUsed = Math.min(currentWallet, calculatedAmount);
      payableAmount = parseFloat((calculatedAmount - walletUsed).toFixed(2));
      await conn.query(
        'UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?',
        [walletUsed, student_id]
      );
    }

    // Require screenshot only if remaining payableAmount > 0 and method is online
    if (payableAmount > 0 && method === 'online' && !screenshot_path) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: 'Payment screenshot is required for online payments'
      });
    }

    const isFullyPaidByWallet = payableAmount === 0;
    const paymentStatus = isFullyPaidByWallet ? 'verified' : 'pending';
    const paymentNotes = isFullyPaidByWallet
      ? 'Paid 100% using Mess Wallet balance'
      : walletUsed > 0
        ? `Mess Wallet credit of ₹${walletUsed.toFixed(2)} applied`
        : null;

    // 1. Create payment record
    const [paymentResult] = await conn.query(
      `INSERT INTO payments (student_id, amount, method, screenshot_path, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [student_id, payableAmount, method, screenshot_path, paymentStatus, paymentNotes]
    );
    const payment_id = paymentResult.insertId;

    // 2. Create coupon_order record
    const [orderResult] = await conn.query(
      `INSERT INTO coupon_orders (student_id, payment_id, start_date, end_date, meals_selected, includes_sunday, wallet_used)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [student_id, payment_id, start_date, end_date, JSON.stringify(meals_selected), includes_sunday, walletUsed]
    );
    const order_id = orderResult.insertId;

    // 3. Log wallet debit if wallet balance was applied
    if (walletUsed > 0) {
      await conn.query(
        `INSERT INTO wallet_transactions (student_id, amount, type, reason, reference_id)
         VALUES (?, ?, 'debit', ?, ?)`,
        [student_id, walletUsed, `Applied to Coupon Order #${order_id} (${start_date} to ${end_date})`, order_id]
      );
    }

    // 4. If 100% covered by Mess Wallet, activate coupons immediately
    if (isFullyPaidByWallet) {
      for (const item of datesToGenerate) {
        await conn.query(
          `INSERT INTO coupons (student_id, meal_type, meal_date, source, status)
           VALUES (?, ?, ?, 'prepaid', 'active')
           ON DUPLICATE KEY UPDATE status = 'active'`,
          [student_id, item.meal, item.dateStr]
        );
      }
    }

    await conn.commit();

    return res.status(201).json({
      success: true,
      message: isFullyPaidByWallet
        ? 'Order paid completely via Mess Wallet and coupons activated immediately!'
        : 'Order created successfully. Coupons will be generated once remaining payment is verified by admin.',
      order: {
        order_id,
        payment_id,
        total_cost: calculatedAmount,
        wallet_used: walletUsed,
        amount: payableAmount,
        payment_status: paymentStatus,
        start_date,
        end_date,
        includes_sunday
      }
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error('Error buying coupons:', error);
    return res.status(500).json({ success: false, message: 'Server error processing order', error: error.message });
  } finally {
    if (conn) conn.release();
  }
});

// 4. GET /coupons — return all coupons for logged-in student, with filters
router.get('/coupons', async (req, res) => {
  try {
    const student_id = req.session.user.id;
    const { status, date } = req.query;

    let sql = `SELECT id, student_id, meal_type, meal_date, source, status, claimed_at, created_at
               FROM coupons
               WHERE student_id = ?`;
    const params = [student_id];

    if (status) {
      sql += ' AND status = ?';
      params.push(status.trim());
    }
    if (date) {
      sql += ' AND meal_date = ?';
      params.push(date.trim());
    }

    sql += " ORDER BY meal_date DESC, FIELD(meal_type, 'breakfast','lunch','snacks','dinner')";

    const [rows] = await db.query(sql, params);
    return res.json({ success: true, coupons: rows });
  } catch (error) {
    console.error('Error fetching coupons:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching coupons', error: error.message });
  }
});

// 5. POST /coupons/:id/skip — mark a future coupon as "skipped" and refund meal price to Mess Wallet
router.post('/coupons/:id/skip', async (req, res) => {
  let conn;
  try {
    const student_id = req.session.user.id;
    const coupon_id = req.params.id;

    conn = await db.getConnection();
    await conn.beginTransaction();

    // Verify coupon ownership and lock row
    const [coupons] = await conn.query(
      `SELECT id, student_id, meal_type, meal_date, status
       FROM coupons
       WHERE id = ? AND student_id = ? FOR UPDATE`,
      [coupon_id, student_id]
    );

    if (coupons.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }

    const coupon = coupons[0];
    if (coupon.status !== 'active') {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: `Cannot skip coupon with status '${coupon.status}'. Only active coupons can be skipped.`
      });
    }

    const todayIST = getISTDateString();
    const couponDateStr = coupon.meal_date instanceof Date ? getISTDateString(coupon.meal_date) : String(coupon.meal_date).split('T')[0];

    // Strict rule: Cannot cancel or skip meals on the current day or past dates
    if (couponDateStr <= todayIST) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel or skip meals on the current day or past dates. Meals must be skipped at least 1 day in advance.'
      });
    }

    // Look up meal refund price
    const prices = await getMealPrices(conn);
    const mealTypeLower = coupon.meal_type.toLowerCase();
    const refundAmount = prices[mealTypeLower] || 0;

    // 1. Update coupon status to skipped
    await conn.query(
      `UPDATE coupons SET status = 'skipped' WHERE id = ?`,
      [coupon_id]
    );

    // 2. Credit meal price to student's Mess Wallet
    if (refundAmount > 0) {
      await conn.query(
        `UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + ? WHERE id = ?`,
        [refundAmount, student_id]
      );
      await conn.query(
        `INSERT INTO wallet_transactions (student_id, amount, type, reason, reference_id)
         VALUES (?, ?, 'credit', ?, ?)`,
        [student_id, refundAmount, `Skipped ${mealTypeLower} (${couponDateStr})`, coupon.id]
      );
    }

    const [updatedUser] = await conn.query(
      'SELECT COALESCE(wallet_balance, 0) AS wallet_balance FROM users WHERE id = ?',
      [student_id]
    );

    await conn.commit();

    return res.json({
      success: true,
      message: `Meal skipped! ₹${refundAmount.toFixed(2)} credited to your Mess Wallet.`,
      coupon_id: coupon.id,
      refunded_amount: refundAmount,
      wallet_balance: parseFloat(updatedUser[0].wallet_balance) || 0
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error('Error skipping coupon:', error);
    return res.status(500).json({ success: false, message: 'Server error skipping coupon', error: error.message });
  } finally {
    if (conn) conn.release();
  }
});

// 6. POST /leave — apply for mess leave (must start tomorrow or later)
router.post('/leave', async (req, res) => {
  try {
    const student_id = req.session.user.id;
    const { start_date, end_date, reason } = req.body;

    if (!start_date || !end_date) {
      return res.status(400).json({ success: false, message: 'start_date and end_date are required' });
    }

    const todayIST = getISTDateString();
    if (start_date <= todayIST) {
      return res.status(400).json({
        success: false,
        message: 'Mess leave cannot start on the current day or past dates. Please select tomorrow or a future date.'
      });
    }

    if (end_date < start_date) {
      return res.status(400).json({ success: false, message: 'end_date must be greater than or equal to start_date' });
    }

    // Guardrail: Prevent overlapping leave applications
    const [overlapLeaves] = await db.query(
      `SELECT id, start_date, end_date
       FROM mess_leave
       WHERE student_id = ?
         AND status IN ('pending', 'approved')
         AND NOT (end_date < ? OR start_date > ?)`,
      [student_id, start_date, end_date]
    );

    if (overlapLeaves.length > 0) {
      const conflict = overlapLeaves[0];
      const cStart = conflict.start_date instanceof Date ? getISTDateString(conflict.start_date) : String(conflict.start_date).split('T')[0];
      const cEnd = conflict.end_date instanceof Date ? getISTDateString(conflict.end_date) : String(conflict.end_date).split('T')[0];
      return res.status(400).json({
        success: false,
        message: `You already have an active/pending leave request overlapping this period (${cStart} to ${cEnd})`
      });
    }

    const cleanReason = reason ? reason.trim().slice(0, 500) : null;

    const [result] = await db.query(
      `INSERT INTO mess_leave (student_id, start_date, end_date, reason, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [student_id, start_date, end_date, cleanReason]
    );

    return res.status(201).json({
      success: true,
      message: 'Mess leave application submitted successfully',
      leave_id: result.insertId
    });
  } catch (error) {
    console.error('Error applying for leave:', error);
    return res.status(500).json({ success: false, message: 'Server error applying for leave', error: error.message });
  }
});

// 7. GET /leave — view own leave requests
router.get('/leave', async (req, res) => {
  try {
    const student_id = req.session.user.id;
    const [rows] = await db.query(
      `SELECT id, student_id, start_date, end_date, reason, status, approved_by, created_at
       FROM mess_leave
       WHERE student_id = ?
       ORDER BY created_at DESC`,
      [student_id]
    );

    return res.json({ success: true, leaves: rows });
  } catch (error) {
    console.error('Error fetching leaves:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching leaves', error: error.message });
  }
});

// 8. POST /complaints — raise complaint
router.post('/complaints', async (req, res) => {
  try {
    const student_id = req.session.user.id;
    const { meal_type, category, description } = req.body;

    if (!meal_type || !category || !description) {
      return res.status(400).json({
        success: false,
        message: 'meal_type, category, and description are required'
      });
    }

    const mealTypeLower = meal_type.trim().toLowerCase();
    const validMeals = ['breakfast', 'lunch', 'snacks', 'dinner'];
    if (!validMeals.includes(mealTypeLower)) {
      return res.status(400).json({
        success: false,
        message: `Invalid meal_type. Must be one of: ${validMeals.join(', ')}`
      });
    }

    const validCategories = ['food_quality', 'hygiene', 'quantity', 'staff_behavior', 'other'];
    if (!validCategories.includes(category.trim())) {
      return res.status(400).json({
        success: false,
        message: `Invalid category. Must be one of: ${validCategories.join(', ')}`
      });
    }

    const cleanDescription = description.trim();
    if (cleanDescription.length < 5 || cleanDescription.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Description must be between 5 and 1000 characters'
      });
    }

    // Guardrail: Only allowed if current time is within that meal's window (IST)
    if (!isWithinMealWindow(mealTypeLower)) {
      const windowInfo = MEAL_WINDOWS[mealTypeLower]?.label || '';
      return res.status(400).json({
        success: false,
        message: `Complaints for ${mealTypeLower} can only be submitted during its meal window (${windowInfo} IST)`
      });
    }

    const todayIST = getISTDateString();

    const [result] = await db.query(
      `INSERT INTO complaints (student_id, meal_date, meal_type, category, description, status)
       VALUES (?, ?, ?, ?, ?, 'open')`,
      [student_id, todayIST, mealTypeLower, category.trim(), cleanDescription]
    );

    return res.status(201).json({
      success: true,
      message: 'Complaint submitted successfully',
      complaint_id: result.insertId,
      meal_date: todayIST
    });
  } catch (error) {
    console.error('Error creating complaint:', error);
    return res.status(500).json({ success: false, message: 'Server error submitting complaint', error: error.message });
  }
});

// 9. GET /complaints — view own complaints
router.get('/complaints', async (req, res) => {
  try {
    const student_id = req.session.user.id;
    const [rows] = await db.query(
      `SELECT id, student_id, meal_date, meal_type, category, description, status, response, responded_by, resolved_at, created_at
       FROM complaints
       WHERE student_id = ?
       ORDER BY created_at DESC`,
      [student_id]
    );

    return res.json({ success: true, complaints: rows });
  } catch (error) {
    console.error('Error fetching complaints:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching complaints', error: error.message });
  }
});

// 10. GET /payments — view own payment history
router.get('/payments', async (req, res) => {
  try {
    const student_id = req.session.user.id;
    const [rows] = await db.query(
      `SELECT p.id, p.student_id, p.amount, p.method, p.screenshot_path, p.status, p.notes, p.created_at,
              co.id AS order_id, co.start_date, co.end_date, co.meals_selected, co.includes_sunday,
              COALESCE(co.wallet_used, 0) AS wallet_used
       FROM payments p
       LEFT JOIN coupon_orders co ON co.payment_id = p.id
       WHERE p.student_id = ?
       ORDER BY p.created_at DESC`,
      [student_id]
    );

    return res.json({ success: true, payments: rows });
  } catch (error) {
    console.error('Error fetching payments:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching payments', error: error.message });
  }
});

// 11. GET /wallet — view current Mess Wallet balance and transaction history
router.get('/wallet', async (req, res) => {
  try {
    const student_id = req.session.user.id;
    const [[userRow]] = await db.query(
      'SELECT COALESCE(wallet_balance, 0) AS wallet_balance FROM users WHERE id = ?',
      [student_id]
    );
    const [transactions] = await db.query(
      `SELECT id, amount, type, reason, reference_id, created_at
       FROM wallet_transactions
       WHERE student_id = ?
       ORDER BY created_at DESC`,
      [student_id]
    );

    return res.json({
      success: true,
      wallet_balance: parseFloat(userRow?.wallet_balance) || 0,
      transactions
    });
  } catch (error) {
    console.error('Error fetching wallet:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching wallet details', error: error.message });
  }
});

module.exports = router;
