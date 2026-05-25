package com.example.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Update;
import org.apache.ibatis.annotations.Delete;

@Mapper
public interface SampleMapper {

    @Select("""
        select * from sample where update_date = #{businessDate} and id = #{id}
        """)
    @Options(fetchSize=1000)
    Cursor<test> selectById(@Param("businessDate") String businessDate, @Param("id") String id);

    @Select("select * from sample where update_date = #{businessDate} and name like #{name}")
    java.util.List<Sample> selectByName(@Param("businessDate") String businessDate, @Param("name") String name);

    @Insert("insert into sample (id, name, update_date) values (#{id}, #{name}, #{businessDate})")
    int insert(@Param("id") String id, @Param("name") String name, @Param("businessDate") String businessDate);

    @Update("update sample set name = #{name} where id = #{id}")
    int update(@Param("id") String id, @Param("name") String name);

    @Delete("delete from sample where id = #{id}")
    int deleteById(@Param("id") String id);
}
