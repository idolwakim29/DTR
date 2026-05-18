const request = require('supertest');
const express = require('express');
const moment = require('moment-timezone');

// Mock prismaClient before importing routes/controllers
jest.mock('../../prismaClient', () => require('../prismaMock'));
const prismaMock = require('../prismaMock');

const dtrController = require('../../controllers/dtrController');

const app = express();
app.use(express.json());
// Quick mock route to test postKiosk
app.post('/dtr/kiosk', dtrController.postKiosk);

describe('DTR Controller - Kiosk API', () => {
  const PH_TZ = 'Asia/Manila';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should reject invalid user ID', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/dtr/kiosk')
      .send({ userId: 'UNKNOWN123', password: 'password', action: 'time-in' });

    expect(prismaMock.user.findFirst).toHaveBeenCalled();
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/not found/i);
  });

  it('should reject invalid password', async () => {
    const mockUser = {
      id: "u1",
      userId: 'EMP123',
      name: 'John Doe',
      role: 'staff',
      password: 'hashedpassword', // mock will compare against this
      isActive: true
    };
    prismaMock.user.findFirst.mockResolvedValue(mockUser);

    // Mock bcrypt compare to return false
    const bcrypt = require('bcryptjs');
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);

    const res = await request(app)
      .post('/dtr/kiosk')
      .send({ userId: 'EMP123', password: 'wrongpassword', action: 'time-in' });

    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Incorrect password/i);
  });

  // Time-in scenarios are harder to test completely accurately because they rely on new Date() runtime.
  // Using jest.useFakeTimers allows simulating exact clock-ins.
  it('should successfully time-in if window is open', async () => {
    // Fake time: 8:00 AM PH Time
    const fakeTime = moment.tz('2024-05-18 08:00:00', PH_TZ).toDate();
    jest.useFakeTimers({ now: fakeTime });
    
    // Default env vars for windows
    process.env.AFTERNOON_CUTOFF = '13:30';
    process.env.MORNING_START_HOUR = '6';

    const mockUser = {
      id: "u1",
      userId: 'EMP123',
      name: 'John Doe',
      role: 'staff',
      password: 'hashedpassword',
      isActive: true,
      requiredHours: 8
    };
    prismaMock.user.findFirst.mockResolvedValue(mockUser);
    
    const bcrypt = require('bcryptjs');
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    prismaMock.dTRLog.findFirst.mockResolvedValue(null);
    prismaMock.dTRLog.create.mockResolvedValue({ id: 'log1', status: 'in_progress' });

    const res = await request(app)
      .post('/dtr/kiosk')
      .send({ userId: 'EMP123', password: 'correctpassword', action: 'time-in' });

    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/Time In recorded/i);
    expect(prismaMock.dTRLog.create).toHaveBeenCalled();
    
    jest.useRealTimers();
  });
});
