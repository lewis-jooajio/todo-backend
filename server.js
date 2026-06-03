require('dotenv').config({ override: true })
const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')

const app = express()
const PORT = process.env.PORT || 3001

const isProduction = process.env.NODE_ENV === 'production'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
})

app.use(cors())
app.use(express.json())

// GET /todos - 전체 목록 조회
app.get('/todos', async (req, res) => {
  const result = await pool.query('SELECT * FROM todos ORDER BY id DESC')
  res.json(result.rows)
})

// POST /todos - 새 할 일 추가
app.post('/todos', async (req, res) => {
  const { text } = req.body
  if (!text || text.trim() === '') {
    return res.status(400).json({ error: '내용을 입력해주세요.' })
  }
  const result = await pool.query(
    'INSERT INTO todos (text) VALUES ($1) RETURNING *',
    [text.trim()]
  )
  res.status(201).json(result.rows[0])
})

// GET /todos/:id - 단일 조회
app.get('/todos/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const result = await pool.query('SELECT * FROM todos WHERE id = $1', [id])
  if (result.rows.length === 0) {
    return res.status(404).json({ error: '할 일을 찾을 수 없습니다.' })
  }
  res.json(result.rows[0])
})

// PUT /todos/:id - 완료 상태 토글
app.put('/todos/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const result = await pool.query(
    'UPDATE todos SET completed = NOT completed WHERE id = $1 RETURNING *',
    [id]
  )
  if (result.rows.length === 0) {
    return res.status(404).json({ error: '할 일을 찾을 수 없습니다.' })
  }
  res.json(result.rows[0])
})

// DELETE /todos/:id - 삭제
app.delete('/todos/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const result = await pool.query(
    'DELETE FROM todos WHERE id = $1 RETURNING *',
    [id]
  )
  if (result.rows.length === 0) {
    return res.status(404).json({ error: '할 일을 찾을 수 없습니다.' })
  }
  res.status(204).send()
})

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`)
})
