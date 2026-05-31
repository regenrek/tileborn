<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.10.2" name="compat-terrain" tilewidth="16" tileheight="16" tilecount="4" columns="2">
 <image source="../Images/terrain.png" width="32" height="32"/>
 <tile id="0" type="floor" probability="0.7">
  <properties>
   <property name="terrain" type="string" value="floor"/>
  </properties>
 </tile>
 <tile id="1" type="wall" probability="0.3">
  <objectgroup draworder="index" id="2">
   <object id="1" x="0" y="0" width="16" height="16"/>
  </objectgroup>
 </tile>
 <tile id="2" type="water">
  <animation>
   <frame tileid="2" duration="120"/>
   <frame tileid="3" duration="120"/>
  </animation>
 </tile>
 <wangsets>
  <wangset name="compat-terrain-wang" type="corner" tile="0">
   <wangcolor name="floor" color="#44aa44" tile="0" probability="0.8"/>
   <wangcolor name="wall" color="#777777" tile="1" probability="0.2"/>
   <wangtile tileid="0" wangid="1,1,1,1,1,1,1,1"/>
   <wangtile tileid="1" wangid="2,2,2,2,2,2,2,2"/>
  </wangset>
 </wangsets>
</tileset>
