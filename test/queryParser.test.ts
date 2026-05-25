import {
  parseJavaMapper,
  parseJavaMapperMethods,
  parseXmlMapper,
  extractPlaceholders,
  buildExecutableSql,
} from '../src/queryParser';

// ---------------------------------------------------------------------------
// extractPlaceholders
// ---------------------------------------------------------------------------

describe('extractPlaceholders', () => {
  test('#{} placeholders', () => {
    expect(extractPlaceholders('SELECT * FROM t WHERE id = #{id}')).toEqual(['id']);
  });

  test('${} placeholders', () => {
    expect(extractPlaceholders('SELECT * FROM ${tableName} WHERE id = #{id}')).toEqual(['tableName', 'id']);
  });

  test('deduplicates same placeholder', () => {
    expect(extractPlaceholders('#{a} AND #{b} AND #{a}')).toEqual(['a', 'b']);
  });

  test('MyBatis jdbcType option stripped', () => {
    expect(extractPlaceholders('#{name,jdbcType=VARCHAR}')).toEqual(['name']);
  });

  test('empty sql returns empty array', () => {
    expect(extractPlaceholders('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildExecutableSql
// ---------------------------------------------------------------------------

describe('buildExecutableSql', () => {
  test('replaces string param', () => {
    const sql = buildExecutableSql('SELECT * FROM t WHERE name = #{name}', [
      { name: 'name', value: 'Alice', type: 'string' },
    ]);
    expect(sql).toBe("SELECT * FROM t WHERE name = 'Alice'");
  });

  test('replaces number param', () => {
    const sql = buildExecutableSql('SELECT * FROM t WHERE id = #{id}', [
      { name: 'id', value: '42', type: 'number' },
    ]);
    expect(sql).toBe('SELECT * FROM t WHERE id = 42');
  });

  test('replaces null param', () => {
    const sql = buildExecutableSql('SELECT * FROM t WHERE col = #{col}', [
      { name: 'col', value: '', type: 'null' },
    ]);
    expect(sql).toBe('SELECT * FROM t WHERE col = NULL');
  });

  test('missing param renders as NULL', () => {
    const sql = buildExecutableSql('SELECT #{x}', []);
    expect(sql).toBe('SELECT NULL');
  });

  test('escapes single quotes in string', () => {
    const sql = buildExecutableSql("SELECT #{name}", [
      { name: 'name', value: "O'Brien", type: 'string' },
    ]);
    expect(sql).toBe("SELECT 'O''Brien'");
  });

  test('boolean true', () => {
    const sql = buildExecutableSql('SELECT #{flag}', [
      { name: 'flag', value: 'true', type: 'boolean' },
    ]);
    expect(sql).toBe('SELECT TRUE');
  });

  test('date param', () => {
    const sql = buildExecutableSql('SELECT #{dt}', [
      { name: 'dt', value: '2024-01-15', type: 'date' },
    ]);
    expect(sql).toBe("SELECT DATE '2024-01-15'");
  });
});

// ---------------------------------------------------------------------------
// parseJavaMapper — @Select / @Insert / @Update / @Delete annotations
// ---------------------------------------------------------------------------

describe('parseJavaMapper', () => {
  test('single @Select with double-quoted string', () => {
    const content = `
      @Mapper
      public interface UserMapper {
        @Select("SELECT * FROM users WHERE id = #{id}")
        User findById(Long id);
      }
    `;
    const results = parseJavaMapper(content);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('findById');
    expect(results[0].kind).toBe('select');
    expect(results[0].sql).toContain('SELECT * FROM users');
    expect(results[0].params).toEqual(['id']);
  });

  test('@Insert annotation', () => {
    const content = `
      @Insert("INSERT INTO users(name) VALUES(#{name})")
      void insert(String name);
    `;
    const results = parseJavaMapper(content);
    expect(results[0].kind).toBe('insert');
    expect(results[0].id).toBe('insert');
  });

  test('@Update annotation', () => {
    const content = `
      @Update("UPDATE users SET name=#{name} WHERE id=#{id}")
      void updateName(@Param("id") Long id, @Param("name") String name);
    `;
    const results = parseJavaMapper(content);
    expect(results[0].kind).toBe('update');
    expect(results[0].params).toEqual(['name', 'id']);
  });

  test('@Delete annotation', () => {
    const content = `
      @Delete("DELETE FROM users WHERE id=#{id}")
      void deleteById(Long id);
    `;
    const results = parseJavaMapper(content);
    expect(results[0].kind).toBe('delete');
    expect(results[0].id).toBe('deleteById');
  });

  test('Java 15+ text block (triple double-quote)', () => {
    const content = `
      @Select("""
        SELECT *
        FROM users
        WHERE id = #{id}
        """)
      User findById(Long id);
    `;
    const results = parseJavaMapper(content);
    expect(results).toHaveLength(1);
    expect(results[0].sql).toContain('SELECT *');
    expect(results[0].sql).toContain('FROM users');
    expect(results[0].params).toEqual(['id']);
  });

  test('multiple annotations in same file', () => {
    const content = `
      @Mapper
      public interface SampleMapper {
        @Select("SELECT * FROM a WHERE id = #{id}")
        A getA(Long id);

        @Insert("INSERT INTO b(name) VALUES(#{name})")
        void insertB(String name);

        @Delete("DELETE FROM c WHERE id = #{id}")
        void deleteC(Long id);
      }
    `;
    const results = parseJavaMapper(content);
    expect(results).toHaveLength(3);
    expect(results.map(r => r.kind)).toEqual(['select', 'insert', 'delete']);
  });

  test('escaped newline in SQL string', () => {
    const content = `
      @Select("SELECT *\\nFROM users\\nWHERE id = #{id}")
      User find(Long id);
    `;
    const results = parseJavaMapper(content);
    expect(results[0].sql).toContain('\n');
  });

  test('returns empty array when no annotations', () => {
    const content = `
      public interface PlainInterface {
        void doSomething();
      }
    `;
    expect(parseJavaMapper(content)).toHaveLength(0);
  });

  test('single-quoted string style (backtick fallback not applicable - verifies double-quote)', () => {
    const content = `@Select("SELECT 1 FROM dual")
    Integer ping();`;
    const results = parseJavaMapper(content);
    expect(results[0].sql).toBe('SELECT 1 FROM dual');
  });

  test('method name fallback when no method follows annotation', () => {
    const content = `@Select("SELECT 1")`;
    const results = parseJavaMapper(content);
    expect(results[0].id).toBe('query_1');
  });
});

// ---------------------------------------------------------------------------
// parseJavaMapperMethods — XML-mapped interface (no inline SQL)
// ---------------------------------------------------------------------------

describe('parseJavaMapperMethods', () => {
  test('extracts method with kind inferred from prefix', () => {
    const content = `
      @Mapper
      public interface UserMapper {
        User findById(Long id);
        List<User> listAll();
        void insertUser(User user);
        void updateUser(User user);
        void deleteById(Long id);
      }
    `;
    const results = parseJavaMapperMethods(content);
    const kinds = Object.fromEntries(results.map(r => [r.id, r.kind]));
    expect(kinds['findById']).toBe('select');
    expect(kinds['listAll']).toBe('select');
    expect(kinds['insertUser']).toBe('insert');
    expect(kinds['updateUser']).toBe('update');
    expect(kinds['deleteById']).toBe('delete');
  });

  test('extracts @Param annotation values as placeholder names', () => {
    const content = `
      @Mapper
      public interface Mapper {
        List<User> findByNameAndAge(@Param("name") String name, @Param("age") int age);
      }
    `;
    const results = parseJavaMapperMethods(content);
    expect(results[0].params).toEqual(['name', 'age']);
  });

  test('falls back to variable names when no @Param', () => {
    const content = `
      @Mapper
      public interface Mapper {
        User findById(Long userId);
      }
    `;
    const results = parseJavaMapperMethods(content);
    expect(results[0].params).toEqual(['userId']);
  });

  test('skips duplicate method names', () => {
    const content = `
      @Mapper
      public interface Mapper {
        User findById(Long id);
        User findById(String name);
      }
    `;
    const results = parseJavaMapperMethods(content);
    expect(results.filter(r => r.id === 'findById')).toHaveLength(1);
  });

  test('skips lines with reserved words as method name', () => {
    const content = `
      @Mapper
      public interface Mapper {
        void doWork(String param);
      }
    `;
    const results = parseJavaMapperMethods(content);
    expect(results.map(r => r.id)).not.toContain('void');
  });

  test('sql field is empty string (to be filled by user)', () => {
    const content = `
      @Mapper
      public interface Mapper {
        List<Item> findAll();
      }
    `;
    const results = parseJavaMapperMethods(content);
    expect(results[0].sql).toBe('');
  });
});

// ---------------------------------------------------------------------------
// parseXmlMapper
// ---------------------------------------------------------------------------

describe('parseXmlMapper', () => {
  test('parses <select> element', () => {
    const content = `
      <?xml version="1.0"?>
      <!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
        "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
      <mapper namespace="com.example.UserMapper">
        <select id="findById" resultType="User">
          SELECT * FROM users WHERE id = #{id}
        </select>
      </mapper>
    `;
    const results = parseXmlMapper(content);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('findById');
    expect(results[0].kind).toBe('select');
    expect(results[0].sql).toContain('SELECT * FROM users');
    expect(results[0].params).toEqual(['id']);
  });

  test('parses multiple statement types', () => {
    const content = `
      <mapper namespace="com.example.Mapper">
        <select id="get" resultType="Item">SELECT 1</select>
        <insert id="add">INSERT INTO t VALUES(#{v})</insert>
        <update id="modify">UPDATE t SET a=#{a}</update>
        <delete id="remove">DELETE FROM t WHERE id=#{id}</delete>
      </mapper>
    `;
    const results = parseXmlMapper(content);
    expect(results).toHaveLength(4);
    expect(results.map(r => r.kind)).toEqual(['select', 'insert', 'update', 'delete']);
  });

  test('strips XML comments from SQL', () => {
    const content = `
      <mapper namespace="x">
        <select id="q" resultType="R">
          SELECT * FROM t <!-- where id = 1 --> WHERE active = 1
        </select>
      </mapper>
    `;
    const results = parseXmlMapper(content);
    expect(results[0].sql).not.toContain('<!--');
    expect(results[0].sql).toContain('WHERE active = 1');
  });

  test('returns empty array when no statements', () => {
    const content = '<mapper namespace="x"></mapper>';
    expect(parseXmlMapper(content)).toHaveLength(0);
  });
});
