package com.example.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Delete;

@Mapper
public interface UserMapper {

    @Select("select id, name, email, created_at from users where id = #{id}")
    User findById(@Param("id") Long id);

    @Select("select id, name, email, created_at from users where email = #{email}")
    User findByEmail(@Param("email") String email);

    @Select("select id, name, email, created_at from users where created_at >= #{fromDate} and created_at < #{toDate} order by created_at desc")
    java.util.List<User> findByDateRange(@Param("fromDate") String fromDate, @Param("toDate") String toDate);

    @Insert("insert into users (name, email, created_at) values (#{name}, #{email}, #{createdAt})")
    int insert(@Param("name") String name, @Param("email") String email, @Param("createdAt") String createdAt);

    @Delete("delete from users where id = #{id}")
    int deleteById(@Param("id") Long id);
}
