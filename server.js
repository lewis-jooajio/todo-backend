require('dotenv').config({ override: true })
const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')
const jwt = require('jsonwebtoken')

const app = express()
const PORT = process.env.PORT || 3001
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key'

const isProduction = process.env.NODE_ENV === 'production'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
})

app.use(cors())
app.use(express.json())

// DB 초기화 — 앱 시작 시 테이블이 없으면 생성
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      nickname VARCHAR(50) NOT NULL,
      device_id VARCHAR(100) UNIQUE NOT NULL
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS todos (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      completed BOOLEAN DEFAULT false,
      user_id INTEGER REFERENCES users(id)
    )
  `)
  // 기존 todos에 컬럼이 없으면 추가
  await pool.query(`
    ALTER TABLE todos ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)
  `)
  await pool.query(`
    ALTER TABLE todos ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
  `)
}
initDB()

// JWT 인증 미들웨어
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' })
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: '유효하지 않은 토큰입니다.' })
  }
}

// POST /auth/login — device_id로 자동 로그인 또는 닉네임으로 신규 가입
app.post('/auth/login', async (req, res) => {
  const { device_id, nickname } = req.body
  if (!device_id) return res.status(400).json({ error: 'device_id가 필요합니다.' })

  // 기존 기기인지 확인
  let result = await pool.query('SELECT * FROM users WHERE device_id = $1', [device_id])

  if (result.rows.length === 0) {
    // 신규 기기 — 닉네임 필요
    if (!nickname || nickname.trim() === '') {
      return res.status(404).json({ error: '닉네임을 입력해주세요.' })
    }
    result = await pool.query(
      'INSERT INTO users (nickname, device_id) VALUES ($1, $2) RETURNING *',
      [nickname.trim(), device_id]
    )
  }

  const user = result.rows[0]
  const token = jwt.sign({ id: user.id, nickname: user.nickname }, JWT_SECRET, { expiresIn: '30d' })
  res.json({ token, user: { id: user.id, nickname: user.nickname } })
})

// PATCH /auth/nickname - 닉네임 변경 (로그인 필요, 중복 확인)
app.patch('/auth/nickname', authMiddleware, async (req, res) => {
  const { nickname } = req.body
  if (!nickname || nickname.trim() === '') {
    return res.status(400).json({ error: '닉네임을 입력해주세요.' })
  }
  const duplicate = await pool.query(
    'SELECT id FROM users WHERE nickname = $1 AND id != $2',
    [nickname.trim(), req.user.id]
  )
  if (duplicate.rows.length > 0) {
    return res.status(409).json({ error: '이미 사용 중인 닉네임이에요.' })
  }
  const result = await pool.query(
    'UPDATE users SET nickname = $1 WHERE id = $2 RETURNING *',
    [nickname.trim(), req.user.id]
  )
  const user = result.rows[0]
  const token = jwt.sign({ id: user.id, nickname: user.nickname }, JWT_SECRET, { expiresIn: '30d' })
  res.json({ token, user: { id: user.id, nickname: user.nickname } })
})

// GET /todos - 전체 목록 조회 (작성자 닉네임 포함)
app.get('/todos', async (req, res) => {
  const result = await pool.query(`
    SELECT todos.*, users.nickname AS author
    FROM todos
    LEFT JOIN users ON todos.user_id = users.id
    ORDER BY todos.created_at DESC
  `)
  res.json(result.rows)
})

// POST /todos - 새 할 일 추가 (로그인 필요)
app.post('/todos', authMiddleware, async (req, res) => {
  const { text } = req.body
  if (!text || text.trim() === '') {
    return res.status(400).json({ error: '내용을 입력해주세요.' })
  }
  const result = await pool.query(
    'INSERT INTO todos (text, user_id) VALUES ($1, $2) RETURNING *',
    [text.trim(), req.user.id]
  )
  const todo = { ...result.rows[0], author: req.user.nickname }
  res.status(201).json(todo)
})

// GET /todos/:id - 단일 조회
app.get('/todos/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const result = await pool.query(`
    SELECT todos.*, users.nickname AS author
    FROM todos
    LEFT JOIN users ON todos.user_id = users.id
    WHERE todos.id = $1
  `, [id])
  if (result.rows.length === 0) {
    return res.status(404).json({ error: '할 일을 찾을 수 없습니다.' })
  }
  res.json(result.rows[0])
})

// PUT /todos/:id - 완료 상태 토글 (로그인 필요)
app.put('/todos/:id', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id)
  const result = await pool.query(
    'UPDATE todos SET completed = NOT completed WHERE id = $1 AND user_id = $2 RETURNING *',
    [id, req.user.id]
  )
  if (result.rows.length === 0) {
    return res.status(403).json({ error: '권한이 없습니다.' })
  }
  const todo = { ...result.rows[0], author: req.user.nickname }
  res.json(todo)
})

// PATCH /todos/:id - 텍스트 수정 (로그인 필요)
app.patch('/todos/:id', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id)
  const { text } = req.body
  if (!text || text.trim() === '') {
    return res.status(400).json({ error: '내용을 입력해주세요.' })
  }
  const result = await pool.query(
    'UPDATE todos SET text = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
    [text.trim(), id, req.user.id]
  )
  if (result.rows.length === 0) {
    return res.status(403).json({ error: '권한이 없습니다.' })
  }
  const todo = { ...result.rows[0], author: req.user.nickname }
  res.json(todo)
})

// DELETE /todos/:id - 삭제 (로그인 필요)
app.delete('/todos/:id', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id)
  const result = await pool.query(
    'DELETE FROM todos WHERE id = $1 AND user_id = $2 RETURNING *',
    [id, req.user.id]
  )
  if (result.rows.length === 0) {
    return res.status(403).json({ error: '권한이 없습니다.' })
  }
  res.status(204).send()
})

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`)
})
