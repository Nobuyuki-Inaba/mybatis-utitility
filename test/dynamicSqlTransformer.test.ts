import { transformDynamicSql } from '../src/dynamicSqlTransformer';
import { ParamEntry } from '../src/types';

function p(name: string, value: string, type: ParamEntry['type'] = 'string'): ParamEntry {
  return { name, value, type };
}

// ---------------------------------------------------------------------------
// <script> wrapper
// ---------------------------------------------------------------------------

describe('<script> wrapper', () => {
  test('strips outer <script> tag', () => {
    const sql = '<script>SELECT * FROM t</script>';
    expect(transformDynamicSql(sql, [])).toBe('SELECT * FROM t');
  });

  test('transforms inner tags after stripping <script>', () => {
    const sql = '<script>SELECT * FROM t <where><if test="id != null">AND id = #{id}</if></where></script>';
    expect(transformDynamicSql(sql, [p('id', '1', 'number')])).toBe('SELECT * FROM t WHERE id = #{id}');
  });
});

// ---------------------------------------------------------------------------
// <if>
// ---------------------------------------------------------------------------

describe('<if>', () => {
  test('includes block when test is true (param not null)', () => {
    const sql = 'SELECT * FROM t<if test="name != null"> WHERE name = #{name}</if>';
    expect(transformDynamicSql(sql, [p('name', 'Alice')])).toBe('SELECT * FROM t WHERE name = #{name}');
  });

  test('excludes block when test is false (param is null)', () => {
    const sql = 'SELECT * FROM t<if test="name != null"> WHERE name = #{name}</if>';
    expect(transformDynamicSql(sql, [p('name', '', 'null')])).toBe('SELECT * FROM t');
  });

  test('excludes block when param value is empty string', () => {
    const sql = '<if test="x != null">x</if>';
    expect(transformDynamicSql(sql, [p('x', '')])).toBe('');
  });

  test('numeric comparison: param > 0', () => {
    const sql = '<if test="age > 0">ok</if>';
    expect(transformDynamicSql(sql, [p('age', '5', 'number')])).toBe('ok');
    expect(transformDynamicSql(sql, [p('age', '0', 'number')])).toBe('');
  });

  test('string equality', () => {
    const sql = '<if test="type == \'admin\'">ADMIN</if>';
    expect(transformDynamicSql(sql, [p('type', 'admin')])).toBe('ADMIN');
    expect(transformDynamicSql(sql, [p('type', 'user')])).toBe('');
  });

  test('and / or conditions', () => {
    const sql = '<if test="a != null and b != null">ok</if>';
    expect(transformDynamicSql(sql, [p('a', '1'), p('b', '2')])).toBe('ok');
    expect(transformDynamicSql(sql, [p('a', '1'), p('b', '')])).toBe('');
  });

  test('nested <if>', () => {
    const sql = '<if test="a != null"><if test="b != null">inner</if></if>';
    expect(transformDynamicSql(sql, [p('a', '1'), p('b', '2')])).toBe('inner');
    expect(transformDynamicSql(sql, [p('a', '1'), p('b', '')])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// <where>
// ---------------------------------------------------------------------------

describe('<where>', () => {
  test('produces WHERE clause with leading AND stripped', () => {
    const sql = 'SELECT * FROM t <where><if test="id != null">AND id = #{id}</if></where>';
    expect(transformDynamicSql(sql, [p('id', '1')])).toBe('SELECT * FROM t WHERE id = #{id}');
  });

  test('produces nothing when all conditions are false', () => {
    const sql = 'SELECT * FROM t <where><if test="id != null">AND id = #{id}</if></where>';
    expect(transformDynamicSql(sql, [p('id', '')]).trim()).toBe('SELECT * FROM t');
  });

  test('strips leading OR', () => {
    const sql = '<where><if test="x != null">OR x = 1</if></where>';
    expect(transformDynamicSql(sql, [p('x', '1')])).toBe('WHERE x = 1');
  });

  test('multiple conditions: first null, second not null', () => {
    const sql = 'SELECT 1 <where>'
      + '<if test="a != null"> AND a = #{a}</if>'
      + '<if test="b != null"> AND b = #{b}</if>'
      + '</where>';
    expect(transformDynamicSql(sql, [p('a', ''), p('b', 'hello')])).toBe('SELECT 1 WHERE b = #{b}');
  });
});

// ---------------------------------------------------------------------------
// <set>
// ---------------------------------------------------------------------------

describe('<set>', () => {
  test('produces SET clause with trailing comma stripped', () => {
    const sql = 'UPDATE t <set><if test="name != null">name = #{name},</if></set> WHERE id = #{id}';
    expect(transformDynamicSql(sql, [p('name', 'Bob'), p('id', '1')])).toBe('UPDATE t SET name = #{name} WHERE id = #{id}');
  });
});

// ---------------------------------------------------------------------------
// <trim>
// ---------------------------------------------------------------------------

describe('<trim>', () => {
  test('adds prefix and strips prefixOverrides', () => {
    const sql = '<trim prefix="WHERE" prefixOverrides="AND |OR ">'
      + '<if test="x != null">AND x = #{x}</if>'
      + '</trim>';
    expect(transformDynamicSql(sql, [p('x', '1')])).toBe('WHERE x = #{x}');
  });

  test('empty inner content produces nothing', () => {
    const sql = '<trim prefix="WHERE" prefixOverrides="AND |OR ">'
      + '<if test="x != null">AND x = 1</if>'
      + '</trim>';
    expect(transformDynamicSql(sql, [p('x', '')])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// <foreach>
// ---------------------------------------------------------------------------

describe('<foreach>', () => {
  test('expands comma-separated number list into IN clause', () => {
    const sql = 'SELECT * FROM t WHERE id IN <foreach collection="ids" item="id" open="(" close=")" separator=",">#{id}</foreach>';
    const result = transformDynamicSql(sql, [p('ids', '1,2,3', 'number')]);
    expect(result).toBe('SELECT * FROM t WHERE id IN (1, 2, 3)');
  });

  test('expands string list with quoting', () => {
    const sql = '<foreach collection="names" item="name" open="(" close=")" separator=",">#{name}</foreach>';
    const result = transformDynamicSql(sql, [p('names', 'Alice,Bob', 'string')]);
    expect(result).toBe("('Alice', 'Bob')");
  });

  test('empty collection produces empty string', () => {
    const sql = '<foreach collection="ids" item="id" open="(" close=")" separator=",">#{id}</foreach>';
    expect(transformDynamicSql(sql, [p('ids', '')])).toBe('');
  });

  test('null collection produces empty string', () => {
    const sql = '<foreach collection="ids" item="id" open="(" close=")" separator=",">#{id}</foreach>';
    expect(transformDynamicSql(sql, [p('ids', '', 'null')])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// <choose> / <when> / <otherwise>
// ---------------------------------------------------------------------------

describe('<choose>', () => {
  test('picks first matching <when>', () => {
    const sql = '<choose>'
      + '<when test="type == \'a\'">A</when>'
      + '<when test="type == \'b\'">B</when>'
      + '<otherwise>C</otherwise>'
      + '</choose>';
    expect(transformDynamicSql(sql, [p('type', 'b')])).toBe('B');
  });

  test('falls through to <otherwise>', () => {
    const sql = '<choose>'
      + '<when test="type == \'a\'">A</when>'
      + '<otherwise>C</otherwise>'
      + '</choose>';
    expect(transformDynamicSql(sql, [p('type', 'z')])).toBe('C');
  });

  test('returns empty when no match and no otherwise', () => {
    const sql = '<choose><when test="x != null">X</when></choose>';
    expect(transformDynamicSql(sql, [p('x', '')])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// <bind>
// ---------------------------------------------------------------------------

describe('<bind>', () => {
  test('binds a concatenated string variable', () => {
    const sql = '<bind name="pattern" value="\'%\' + keyword + \'%\'"/>WHERE name LIKE #{pattern}';
    const result = transformDynamicSql(sql, [p('keyword', 'foo')]);
    // After bind, #{pattern} is a placeholder — it stays as-is (substituion is done by buildExecutableSql)
    expect(result).toContain('#{pattern}');
  });
});

// ---------------------------------------------------------------------------
// CDATA stripping
// ---------------------------------------------------------------------------

describe('CDATA', () => {
  test('strips CDATA wrappers', () => {
    const sql = 'SELECT * FROM t WHERE <![CDATA[ age > #{age} ]]>';
    expect(transformDynamicSql(sql, [p('age', '5', 'number')])).toContain('age > #{age}');
  });
});

// ---------------------------------------------------------------------------
// Plain SQL passthrough
// ---------------------------------------------------------------------------

describe('plain SQL passthrough', () => {
  test('returns unchanged SQL when no dynamic tags present', () => {
    const sql = 'SELECT * FROM users WHERE id = #{id}';
    expect(transformDynamicSql(sql, [p('id', '1')])).toBe(sql);
  });
});

// ===========================================================================
// Patterns from https://mybatis.org/mybatis-3/ja/dynamic-sql.html
// ===========================================================================

// ---------------------------------------------------------------------------
// Doc pattern: <if> — findActiveBlogWithTitleLike
// ---------------------------------------------------------------------------
describe('doc: if — findActiveBlogWithTitleLike', () => {
  const sql = `SELECT * FROM BLOG
  WHERE state = 'ACTIVE'
  <if test="title != null">
    AND title like #{title}
  </if>`;

  test('includes AND clause when title is set', () => {
    const result = transformDynamicSql(sql, [p('title', 'MyBatis')]);
    expect(result).toContain('AND title like #{title}');
  });

  test('omits AND clause when title is null', () => {
    const result = transformDynamicSql(sql, [p('title', '')]);
    expect(result).not.toContain('AND title');
    expect(result).toContain("WHERE state = 'ACTIVE'");
  });
});

// ---------------------------------------------------------------------------
// Doc pattern: <if> — compound: author != null and author.name != null
// ---------------------------------------------------------------------------
describe('doc: if — compound with nested property', () => {
  // In our flat param model author.name always resolves to null (author is scalar).
  // Condition evaluates false unless author param itself is treated as the name.
  const sql = `SELECT * FROM BLOG WHERE state = 'ACTIVE'
  <if test="title != null">
    AND title like #{title}
  </if>
  <if test="author != null">
    AND author_name like #{author}
  </if>`;

  test('includes author clause when author is set', () => {
    const result = transformDynamicSql(sql, [p('title', ''), p('author', 'Joe')]);
    expect(result).toContain('AND author_name like #{author}');
    expect(result).not.toContain('AND title');
  });

  test('includes both when both set', () => {
    const result = transformDynamicSql(sql, [p('title', 'foo'), p('author', 'Joe')]);
    expect(result).toContain('AND title like #{title}');
    expect(result).toContain('AND author_name like #{author}');
  });
});

// ---------------------------------------------------------------------------
// Doc pattern: <choose>/<when>/<otherwise>
// ---------------------------------------------------------------------------
describe('doc: choose/when/otherwise — findActiveBlogLike', () => {
  const sql = `SELECT * FROM BLOG WHERE state = 'ACTIVE'
  <choose>
    <when test="title != null">
      AND title like #{title}
    </when>
    <when test="author != null">
      AND author_name like #{author}
    </when>
    <otherwise>
      AND featured = 1
    </otherwise>
  </choose>`;

  test('picks first matching when (title)', () => {
    const result = transformDynamicSql(sql, [p('title', 'foo'), p('author', 'Joe')]);
    expect(result).toContain('AND title like #{title}');
    expect(result).not.toContain('AND author_name');
    expect(result).not.toContain('AND featured');
  });

  test('picks second when (author, title null)', () => {
    const result = transformDynamicSql(sql, [p('title', ''), p('author', 'Joe')]);
    expect(result).toContain('AND author_name like #{author}');
    expect(result).not.toContain('AND title');
  });

  test('falls through to otherwise when both null', () => {
    const result = transformDynamicSql(sql, [p('title', ''), p('author', '')]);
    expect(result).toContain('AND featured = 1');
  });
});

// ---------------------------------------------------------------------------
// Doc pattern: <where> — findActiveBlogLike
// ---------------------------------------------------------------------------
describe('doc: where — findActiveBlogLike', () => {
  const sql = `SELECT * FROM BLOG
  <where>
    <if test="state != null">
      state = #{state}
    </if>
    <if test="title != null">
      AND title like #{title}
    </if>
    <if test="author != null">
      AND author_name like #{author}
    </if>
  </where>`;

  test('all three conditions active', () => {
    const result = transformDynamicSql(sql, [
      p('state', 'ACTIVE'), p('title', 'foo'), p('author', 'Joe'),
    ]);
    expect(result).toContain('WHERE');
    expect(result).toContain('state = #{state}');
    expect(result).toContain('AND title like #{title}');
    expect(result).toContain('AND author_name like #{author}');
  });

  test('only title active — leading AND stripped', () => {
    const result = transformDynamicSql(sql, [
      p('state', ''), p('title', 'foo'), p('author', ''),
    ]);
    expect(result).toContain('WHERE');
    // Leading AND must be removed
    expect(result).not.toMatch(/WHERE\s+AND/i);
    expect(result).toContain('title like #{title}');
  });

  test('all null — WHERE omitted entirely', () => {
    const result = transformDynamicSql(sql, [
      p('state', ''), p('title', ''), p('author', ''),
    ]);
    expect(result).not.toContain('WHERE');
  });
});

// ---------------------------------------------------------------------------
// Doc pattern: <trim prefix="WHERE" prefixOverrides="AND |OR ">
// ---------------------------------------------------------------------------
describe('doc: trim — WHERE equivalent', () => {
  const sql = `SELECT * FROM BLOG
  <trim prefix="WHERE" prefixOverrides="AND |OR ">
    <if test="state != null">
      state = #{state}
    </if>
    <if test="title != null">
      AND title like #{title}
    </if>
  </trim>`;

  test('adds WHERE and strips leading AND', () => {
    const result = transformDynamicSql(sql, [p('state', ''), p('title', 'foo')]);
    expect(result).toContain('WHERE');
    expect(result).not.toMatch(/WHERE\s+AND/i);
    expect(result).toContain('title like #{title}');
  });

  test('"AND |OR " — space in pattern prevents matching partial words like ORDER', () => {
    // "OR " pattern should NOT strip the "OR" from "ORDER BY"
    const trimSql = '<trim prefix="WHERE" prefixOverrides="AND |OR ">ORDER BY id</trim>';
    const result = transformDynamicSql(trimSql, []);
    // "ORDER" starts with "OR" but NOT "OR " — must NOT be stripped
    expect(result).toContain('ORDER BY id');
  });
});

// ---------------------------------------------------------------------------
// Doc pattern: <set> — updateAuthorIfNecessary
// ---------------------------------------------------------------------------
describe('doc: set — updateAuthorIfNecessary', () => {
  const sql = `update Author
  <set>
    <if test="username != null">username=#{username},</if>
    <if test="password != null">password=#{password},</if>
    <if test="email != null">email=#{email},</if>
    <if test="bio != null">bio=#{bio}</if>
  </set>
  where id=#{id}`;

  test('all fields set — trailing comma stripped', () => {
    const result = transformDynamicSql(sql, [
      p('username', 'u'), p('password', 'p'), p('email', 'e'), p('bio', 'b'), p('id', '1'),
    ]);
    expect(result).toContain('SET');
    expect(result).not.toMatch(/,\s*where/i);
    expect(result).toContain('username=#{username}');
    expect(result).toContain('bio=#{bio}');
  });

  test('only username set', () => {
    const result = transformDynamicSql(sql, [
      p('username', 'u'), p('password', ''), p('email', ''), p('bio', ''), p('id', '1'),
    ]);
    expect(result).toContain('SET');
    expect(result).toContain('username=#{username}');
    expect(result).not.toContain('password');
  });
});

// ---------------------------------------------------------------------------
// Doc pattern: <trim prefix="SET" suffixOverrides=",">
// ---------------------------------------------------------------------------
describe('doc: trim — SET equivalent', () => {
  const sql = `update Author
  <trim prefix="SET" suffixOverrides=",">
    <if test="username != null">username=#{username},</if>
    <if test="bio != null">bio=#{bio},</if>
  </trim>
  where id=#{id}`;

  test('strips trailing comma', () => {
    const result = transformDynamicSql(sql, [
      p('username', 'u'), p('bio', 'b'), p('id', '1'),
    ]);
    expect(result).toContain('SET');
    expect(result).not.toMatch(/,\s*where/i);
  });

  test('only one field', () => {
    const result = transformDynamicSql(sql, [
      p('username', 'u'), p('bio', ''), p('id', '1'),
    ]);
    expect(result).toContain('SET');
    expect(result).toContain('username=#{username}');
    expect(result).not.toMatch(/,\s*where/i);
  });
});

// ---------------------------------------------------------------------------
// Doc pattern: <foreach> inside <where> — selectPostIn
// ---------------------------------------------------------------------------
describe('doc: foreach inside where — selectPostIn', () => {
  const sql = `SELECT * FROM POST P
  <where>
    <foreach item="item" index="index" collection="list"
        open="ID in (" separator="," close=")" nullable="true">
      #{item}
    </foreach>
  </where>`;

  test('expands list into IN clause inside WHERE', () => {
    const result = transformDynamicSql(sql, [p('list', '1,2,3', 'number')]);
    expect(result).toContain('WHERE');
    expect(result).toContain('ID in (');
    expect(result).toContain('1');
    expect(result).toContain('2');
    expect(result).toContain('3');
  });

  test('null list — WHERE omitted', () => {
    const result = transformDynamicSql(sql, [p('list', '')]);
    expect(result).not.toContain('WHERE');
    expect(result).not.toContain('ID in');
  });
});

// ---------------------------------------------------------------------------
// Doc pattern: <bind> — selectBlogsLike
// ---------------------------------------------------------------------------
describe('doc: bind — selectBlogsLike', () => {
  test('simple concat bind creates #{pattern} placeholder', () => {
    const sql = `<bind name="pattern" value="'%' + title + '%'" />
SELECT * FROM BLOG
WHERE title LIKE #{pattern}`;
    const result = transformDynamicSql(sql, [p('title', 'foo')]);
    // bind creates #{pattern} but placeholder substitution is done by buildExecutableSql later
    expect(result).toContain('#{pattern}');
    expect(result).toContain('WHERE title LIKE');
  });
});

// ---------------------------------------------------------------------------
// Doc pattern: <script> — Java annotation @Update
// ---------------------------------------------------------------------------
describe('doc: script — Java @Update annotation', () => {
  test('script wrapping set with multiple if conditions', () => {
    const sql = `<script>
  update Author
    <set>
      <if test='username != null'>username=#{username},</if>
      <if test='password != null'>password=#{password},</if>
      <if test='email != null'>email=#{email},</if>
      <if test='bio != null'>bio=#{bio}</if>
    </set>
  where id=#{id}
</script>`;
    const result = transformDynamicSql(sql, [
      p('username', 'u'), p('password', ''), p('email', 'e'), p('bio', ''), p('id', '1'),
    ]);
    expect(result).toContain('SET');
    expect(result).toContain('username=#{username}');
    expect(result).toContain('email=#{email}');
    expect(result).not.toContain('password');
    expect(result).not.toContain('bio');
    expect(result).not.toMatch(/,\s*where/i);
  });
});

// ---------------------------------------------------------------------------
// OGNL edge cases
// ---------------------------------------------------------------------------

describe('OGNL edge cases', () => {
  test('not operator', () => {
    const sql = '<if test="!flag">yes</if>';
    expect(transformDynamicSql(sql, [p('flag', 'false', 'boolean')])).toBe('yes');
    expect(transformDynamicSql(sql, [p('flag', 'true',  'boolean')])).toBe('');
  });

  test('size() method on comma-separated string', () => {
    const sql = '<if test="ids.size() > 0">ok</if>';
    expect(transformDynamicSql(sql, [p('ids', '1,2,3')])).toBe('ok');
    expect(transformDynamicSql(sql, [p('ids', '')])).toBe('');
  });

  test('combined: null check and size check', () => {
    const sql = '<if test="ids != null and ids.size() > 0">ok</if>';
    expect(transformDynamicSql(sql, [p('ids', '1,2')])).toBe('ok');
    expect(transformDynamicSql(sql, [p('ids', '')])).toBe('');
  });

  test('boolean param truthy/falsy', () => {
    const sql = '<if test="active">yes</if>';
    expect(transformDynamicSql(sql, [p('active', 'true', 'boolean')])).toBe('yes');
    expect(transformDynamicSql(sql, [p('active', 'false', 'boolean')])).toBe('');
  });
});
