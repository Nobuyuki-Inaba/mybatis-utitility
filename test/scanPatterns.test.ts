import {
  makeGlob,
  buildExcludeGlob,
  MAPPER_DEFAULT_EXCLUDE,
  DATASET_DEFAULT_EXCLUDE,
} from '../src/scanUtils';
import {
  isJavaMapper,
  isProviderMapper,
  parseFile,
} from '../src/mapperScanner';

// ---------------------------------------------------------------------------
// makeGlob
// ---------------------------------------------------------------------------

describe('makeGlob', () => {
  test('single folder without wildcards → two patterns wrapped in braces', () => {
    expect(makeGlob(['src/main/java'], '*.java'))
      .toBe('{src/main/java/*.java,src/main/java/**/*.java}');
  });

  test('single **/folder pattern → two patterns wrapped in braces', () => {
    expect(makeGlob(['**/mapper'], '*.java'))
      .toBe('{**/mapper/*.java,**/mapper/**/*.java}');
  });

  test('multiple folders wrap all sub-patterns in single braces', () => {
    const glob = makeGlob(['**/mapper', '**/repository'], '*.java');
    expect(glob).toBe(
      '{**/mapper/*.java,**/mapper/**/*.java,**/repository/*.java,**/repository/**/*.java}'
    );
  });

  test('trailing slash is stripped before expansion', () => {
    expect(makeGlob(['src/main/java/'], '*.java'))
      .toBe('{src/main/java/*.java,src/main/java/**/*.java}');
  });

  test('trailing /** is stripped before expansion', () => {
    expect(makeGlob(['**/mapper/**'], '*.java'))
      .toBe('{**/mapper/*.java,**/mapper/**/*.java}');
  });

  test('trailing /* is stripped before expansion', () => {
    expect(makeGlob(['**/mapper/*'], '*.java'))
      .toBe('{**/mapper/*.java,**/mapper/**/*.java}');
  });

  test('wildcard-ending pattern (after stripping) produces single sub-pattern', () => {
    // "**/mapper*" ends with * after normalization → single pattern
    expect(makeGlob(['**/mapper*'], '*.java')).toBe('**/mapper*/*.java');
  });

  test('works with xml extension', () => {
    expect(makeGlob(['**/mapper'], '*.xml'))
      .toBe('{**/mapper/*.xml,**/mapper/**/*.xml}');
  });
});

// ---------------------------------------------------------------------------
// buildExcludeGlob
// ---------------------------------------------------------------------------

describe('buildExcludeGlob', () => {
  test('result is wrapped in braces', () => {
    const g = buildExcludeGlob(MAPPER_DEFAULT_EXCLUDE, []);
    expect(g.startsWith('{')).toBe(true);
    expect(g.endsWith('}')).toBe(true);
  });

  test('mapper defaults always included', () => {
    const g = buildExcludeGlob(MAPPER_DEFAULT_EXCLUDE, []);
    const parts = g.slice(1, -1).split(',');
    expect(parts).toContain('**/node_modules/**');
    expect(parts).toContain('**/target/**');
    expect(parts).toContain('**/src/test/**');
    expect(parts).toContain('**/src/test-**/**');
  });

  test('dataset defaults always included', () => {
    const g = buildExcludeGlob(DATASET_DEFAULT_EXCLUDE, []);
    const parts = g.slice(1, -1).split(',');
    expect(parts).toContain('**/node_modules/**');
    expect(parts).toContain('**/target/**');
    // dataset defaults do NOT include src/test (datasets may live there)
    expect(parts).not.toContain('**/src/test/**');
  });

  test('user extra patterns are appended and included in glob', () => {
    const g = buildExcludeGlob(MAPPER_DEFAULT_EXCLUDE, ['**/generated/**', '**/legacy/**']);
    const parts = g.slice(1, -1).split(',');
    expect(parts).toContain('**/generated/**');
    expect(parts).toContain('**/legacy/**');
  });

  test('user extra patterns appear after defaults (exclude priority)', () => {
    const g = buildExcludeGlob(MAPPER_DEFAULT_EXCLUDE, ['**/generated/**']);
    const parts = g.slice(1, -1).split(',');
    const defaultEnd = MAPPER_DEFAULT_EXCLUDE.length - 1;
    // All defaults come before user extras
    MAPPER_DEFAULT_EXCLUDE.forEach((d, i) => expect(parts[i]).toBe(d));
    expect(parts[defaultEnd + 1]).toBe('**/generated/**');
  });

  test('empty extras still produces valid glob from defaults alone', () => {
    const g = buildExcludeGlob(MAPPER_DEFAULT_EXCLUDE, []);
    const parts = g.slice(1, -1).split(',');
    expect(parts.length).toBe(MAPPER_DEFAULT_EXCLUDE.length);
  });

  test('multiple extra patterns all appear in output', () => {
    const extras = ['**/a/**', '**/b/**', '**/c/**'];
    const g = buildExcludeGlob([], extras);
    const parts = g.slice(1, -1).split(',');
    extras.forEach(e => expect(parts).toContain(e));
  });
});

// ---------------------------------------------------------------------------
// isProviderMapper
// ---------------------------------------------------------------------------

describe('isProviderMapper', () => {
  test('detects @SelectProvider', () => {
    expect(isProviderMapper('@SelectProvider(type=FooSqlProvider.class)')).toBe(true);
  });

  test('detects @InsertProvider', () => {
    expect(isProviderMapper('@InsertProvider(type=FooSqlProvider.class)')).toBe(true);
  });

  test('detects @UpdateProvider', () => {
    expect(isProviderMapper('@UpdateProvider(type=FooSqlProvider.class)')).toBe(true);
  });

  test('detects @DeleteProvider', () => {
    expect(isProviderMapper('@DeleteProvider(type=FooSqlProvider.class)')).toBe(true);
  });

  test('returns false for @Select (inline SQL annotation)', () => {
    expect(isProviderMapper('@Select("SELECT 1")')).toBe(false);
  });

  test('returns false for @Mapper alone', () => {
    expect(isProviderMapper('@Mapper\npublic interface Foo {}')).toBe(false);
  });

  test('returns false for plain Java without annotations', () => {
    expect(isProviderMapper('public class Foo {}')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseFile — @*Provider files are skipped
// ---------------------------------------------------------------------------

const PROVIDER_MAPPER = `
package com.example;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.SelectProvider;
import org.apache.ibatis.annotations.InsertProvider;

@Mapper
public interface UserMapper {
  @SelectProvider(type=UserSqlProvider.class, method="selectByExample")
  java.util.List<User> selectByExample(UserExample example);

  @InsertProvider(type=UserSqlProvider.class, method="insert")
  int insert(User record);
}
`;

const INLINE_SQL_MAPPER = `
package com.example;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface PingMapper {
  @Select("SELECT 1")
  Integer ping();
}
`;

const MIXED_MAPPER = `
package com.example;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.SelectProvider;

@Mapper
public interface MixedMapper {
  @Select("SELECT 1")
  Integer ping();

  @SelectProvider(type=FooProvider.class, method="expensive")
  java.util.List<String> expensive();
}
`;

describe('parseFile — Provider mapper handling', () => {
  test('returns null for a pure @*Provider mapper (no inline SQL)', () => {
    expect(parseFile('UserMapper.java', PROVIDER_MAPPER)).toBeNull();
  });

  test('isJavaMapper is still true for provider mapper (it has @Mapper)', () => {
    expect(isJavaMapper(PROVIDER_MAPPER)).toBe(true);
  });

  test('returns non-null for inline-SQL-only mapper', () => {
    const result = parseFile('PingMapper.java', INLINE_SQL_MAPPER);
    expect(result).not.toBeNull();
    expect(result!.queries[0].id).toBe('ping');
  });

  test('mixed mapper: inline SQL methods are returned, @SelectProvider method is ignored', () => {
    const result = parseFile('MixedMapper.java', MIXED_MAPPER);
    expect(result).not.toBeNull();
    // Only the @Select method should appear (parseJavaMapper only picks up @Select)
    expect(result!.queries.map(q => q.id)).toContain('ping');
    expect(result!.queries.length).toBe(1);
  });
});
