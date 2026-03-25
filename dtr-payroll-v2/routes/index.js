const express = require('express');
const router  = express.Router();
const authController  = require('../controllers/authController');
const dtrController   = require('../controllers/dtrController');
const adminController = require('../controllers/adminController');
const { isAuthenticated, isAdmin, isStaff } = require('../middleware/auth');

// Auth
router.get('/login',  authController.getLogin);
router.post('/login', authController.postLogin);
router.get('/logout', authController.logout);

// Public kiosk
router.get('/',                dtrController.getKiosk);
router.get('/dtr',             dtrController.getKiosk);
router.post('/dtr/kiosk',      dtrController.postKiosk);
router.get('/dtr/kiosk/recent',dtrController.getRecentLogs);

// Session-based DTR (logged-in staff/students)
router.get('/dtr/me',              isAuthenticated, isStaff, dtrController.getDTRPage);
router.post('/dtr/time-in',        isAuthenticated, isStaff, dtrController.timeIn);
router.post('/dtr/lunch-break',    isAuthenticated, isStaff, dtrController.lunchBreak);
router.post('/dtr/time-out',       isAuthenticated, isStaff, dtrController.timeOut);

// Admin – Dashboard
router.get('/admin/dashboard', isAuthenticated, isAdmin, adminController.getDashboard);

// Admin – Users
router.get('/admin/users',            isAuthenticated, isAdmin, adminController.getUsers);
router.get('/admin/users/new',        isAuthenticated, isAdmin, adminController.getNewUser);
router.post('/admin/users/new',       isAuthenticated, isAdmin, adminController.postNewUser);
router.get('/admin/users/edit/:id',   isAuthenticated, isAdmin, adminController.getEditUser);
router.post('/admin/users/edit/:id',  isAuthenticated, isAdmin, adminController.postEditUser);
router.post('/admin/users/delete/:id',isAuthenticated, isAdmin, adminController.deleteUser);

// Admin – DTR
router.get('/admin/dtr/summary',     isAuthenticated, isAdmin, dtrController.getSummary);
router.get('/admin/dtr/maintenance', isAuthenticated, isAdmin, dtrController.getMaintenanceDTR);
router.get('/admin/dtr/students',    isAuthenticated, isAdmin, dtrController.getStudentDTR);
router.get('/admin/dtr/edit/:id',    isAuthenticated, isAdmin, dtrController.getEditLog);
router.post('/admin/dtr/edit/:id',   isAuthenticated, isAdmin, dtrController.postEditLog);
router.post('/admin/dtr/delete/:id', isAuthenticated, isAdmin, dtrController.deleteLog);

// Admin – Payroll
router.get('/admin/payroll',               isAuthenticated, isAdmin, adminController.getPayroll);
router.get('/admin/payroll/generate',      isAuthenticated, isAdmin, adminController.getGeneratePayroll);
router.post('/admin/payroll/generate',     isAuthenticated, isAdmin, adminController.postGeneratePayroll);
router.post('/admin/payroll/pay/:id',      isAuthenticated, isAdmin, adminController.markPaid);
router.post('/admin/payroll/delete/:id',   isAuthenticated, isAdmin, adminController.deletePayroll);

module.exports = router;
