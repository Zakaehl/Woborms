import * as THREE from "./libs/three.module.js";    //r130
import {createMap} from "./map.js";
import {Robot} from "./robot.js";
import {menu} from "./menu.js";
import {makeCamera, resizeRendererToDisplaySize, resizeAspect} from "./utils.js";

let renderer;

const numTeams = 2;
const robotsPerTeam = 4;
let numRedRobots;               //How many red robots are left
let numBlueRobots;              //How many blue robots are left

let redRobots;                  //Array of red Robot objects
let blueRobots;                 //Array of blue Robot objects
let redRobotIndex;              //Index of the next red robot to play
let blueRobotIndex;             //Index of the next blue robot to play
let currentRobot;

let nextRed;                    //True = a red robot will play the next turn, false = a blue one

let bullets;                    //Array of all bullets
let bulletBodies;

const turnTime = 20;

//Prepare html after coming from the menu
function setUpDocument() {
    document.body.innerHTML = "";

    const canvas = document.createElement("canvas");
    canvas.setAttribute("id", "c");

    const crosshair = document.createElement("div");
    crosshair.setAttribute("id", "crosshair");
    crosshair.innerHTML = "+";

    const power = document.createElement("div");
    power.setAttribute("id", "power");
    power.innerHTML = "POWER: 0";

    const hit = document.createElement("div");
    hit.setAttribute("id", "hit");

    const timer = document.createElement("div");
    timer.setAttribute("id", "timer");
    timer.innerHTML = turnTime;

    const gameOver = document.createElement("div");
    gameOver.setAttribute("id", "gameOver");

    document.body.appendChild(canvas);
    document.body.appendChild(crosshair);
    document.body.appendChild(power);
    document.body.appendChild(hit);
    document.body.appendChild(timer);
    document.body.appendChild(gameOver);

    renderer = new THREE.WebGLRenderer({canvas});
    renderer.shadowMap.enabled = true;
}

//Set up and handle the scene graph (lights, cameras and objects) and physics, handle the gameplay
function main() {
    setUpDocument();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("skyblue");

    //World physics (gravity)
    let world = new CANNON.World();
    world.gravity.set(0, -9.81, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 10;
    world.defaultContactMaterial.friction = 0;      //Prevents bodies from "sliding" during the game

    //Create all lights and objects
    createMap(scene, world);

    //Initialize variables (for when the game restarts)
    numRedRobots = robotsPerTeam;
    numBlueRobots = numRedRobots;
    redRobots = [];
    blueRobots = [];
    bullets = [];
    bulletBodies = [];

    //Create the robots and their cameras
    for (let i=0; i < numTeams * robotsPerTeam; i++) {
        const robot = new Robot(i, scene, world);
        robot.idle();

        //Even index = red team; odd index = blue team
        if (i % 2 == 0) {
            redRobots.push(robot);
        }
        else {
            blueRobots.push(robot);
        }
    };

    //Detached camera looking from above
    const globalCamera = makeCamera(30, 75);
    globalCamera.position.y = 68;
    globalCamera.lookAt(0, 0, 0);

    //First robot to play
    redRobotIndex = 0;
    blueRobotIndex = 0;
    nextRed = false;                           //Blue team will play after the first robot
    currentRobot = redRobots[redRobotIndex];   //First robot is red

    const robotMass = 70;
    currentRobot.body.mass = robotMass;        //Robots that act must be affected by all physics (collide with objects)
    currentRobot.body.type = CANNON.Body.DYNAMIC;
    currentRobot.body.updateMassProperties();

    let camera = currentRobot.thirdPersonCamera;      //Start from first robot's camera

    //KEYBOARD CONTROLS AND TURN HANDLING

    let moveForward = false;
    let moveBackward = false;
    let turnLeft = false;
    let turnRight = false;

    let aimUp = false;
    let aimDown = false;

    let global = false;                 //True = look from above
    let firstPerson = false;            //True = first person camera

    let charging = false;               //True = charging the shot
    let waitForCollision = false;       //True = shot fired -> don't act and wait for next turn

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    
    function handleKeyDown(e) {
        switch (e.code) {
            //Move or shoot only if you haven't shot yet (= !waitForCollision)
            case "KeyW":
            case "ArrowUp":
                if (!waitForCollision) {
                    if (!firstPerson) {         //Move
                        if (!moveForward && !moveBackward) {    //No need to call it again if already moving
                            currentRobot.idleToWalk();
                        }
                        moveForward = true;
                    }
                    else {                      //Aim
                        aimUp = true;
                    }
                }
                break;
            case "KeyS":
            case "ArrowDown":
                if (!waitForCollision) {
                    if (!firstPerson) {         //Move
                        if (!moveForward && !moveBackward) {    //No need to call it again if already moving
                            currentRobot.idleToWalk();
                        }
                        moveBackward = true;
                    }
                    else {                      //Aim
                        aimDown = true;
                    }
                }
                break;
            case "KeyA":
            case "ArrowLeft":
                if (!waitForCollision) {
                    turnLeft = true;            //Move or aim
                }
                break;
            case "KeyD":
            case "ArrowRight":
                if (!waitForCollision) {
                    turnRight = true;           //Move or aim
                }
                break;
            case "Space":                       //Charge
                if (!waitForCollision && firstPerson) {     //While aiming
                    //Stop acting
                    waitForCollision = true;

                    //Reset all flags (stay still)
                    moveForward = false;
                    moveBackward = false;
                    turnLeft = false;
                    turnRight = false;
                    aimUp = false;
                    aimDown = false;

                    charging = true;
                    chargeShot();
                }
                break;
            //Camera handling
            case "KeyE":                //Global camera
                if (!charging) {                //Stay in first person while charging
                    if (!global) {              //Switch to global camera
                        if (firstPerson) {      //If aiming, go back to idle
                            currentRobot.aimToIdle();
                            document.querySelector("#crosshair").style.display = "none";  //Remove gui
                            document.querySelector("#power").style.display = "none";
                        }
                        global = true;
                        firstPerson = false;
                        camera = globalCamera;
                    }
                    else {                      //Switch back to third person camera
                        global = false;
                        firstPerson = false;
                        camera = currentRobot.thirdPersonCamera;
                    }
                }
                break;
            case "KeyQ":                //First person camera
                if (!waitForCollision) {
                    if (!firstPerson) {     //Switch to first person camera
                        //Stop moving while aiming
                        moveForward = false;
                        moveBackward = false;
                        turnLeft = false;
                        turnRight = false;

                        currentRobot.toAim();
                        firstPerson = true;
                        global = false;
                        //Interrupted animations could have left the head looking somewhere else
                        currentRobot.head.rotation.x = 0;
                        camera = currentRobot.firstPersonCamera;

                        //Display gui
                        document.querySelector("#crosshair").style.display = "block";
                        document.querySelector("#power").style.display = "block";
                    }
                    else {                  //Switch back to third person camera
                        //Reset all aiming flags
                        aimUp = false;
                        aimDown = false;
                        turnLeft = false;
                        turnRight = false;

                        currentRobot.aimToIdle();
                        firstPerson = false;
                        global = false;
                        camera = currentRobot.thirdPersonCamera;

                        //Remove gui
                        document.querySelector("#crosshair").style.display = "none";
                        document.querySelector("#power").style.display = "none";
                    }
                }
                break;
        }
    }

    function handleKeyUp(e) {
        switch (e.code) {
            case "KeyW":
            case "ArrowUp":
                if (!firstPerson) {         //Stop moving
                    moveForward = false;
                    if (!moveBackward) {    //Don't go idle if moving in the other direction
                        currentRobot.walkToIdle();
                    }
                }
                else {                      //Stop aiming
                    aimUp = false;
                }
                break;
            case "KeyS":
            case "ArrowDown":
                if (!firstPerson) {         //Stop moving
                    moveBackward = false;
                    if (!moveForward) {     //Don't go idle if moving in the other direction
                        currentRobot.walkToIdle();
                    }
                }
                else {                      //Stop aiming
                    aimDown = false;
                }
                break;
            case "KeyA":
            case "ArrowLeft":
                turnLeft = false;           //Stop moving or aiming
                break;
            case "KeyD":
            case "ArrowRight":
                turnRight = false;          //Stop moving or aiming
                break;
            case "Space":
                charging = false;           //Stop charging
                break;
        }
    }

    countdown();

    //FUNCTIONS USED DURING THE TURN

    function countdown() {
        let time = turnTime;
        let displayedTime;                      //Integer number displayed

        let interval = setInterval(() => {
            if (charging) {                     //Started shooting in time
                clearInterval(interval);        //Delete the countdown
                return;                         //Exit from the cycle now (avoid further iterations)
            }

            time -= 0.01;
            displayedTime = (Math.ceil(time));  //Changes every one second
            if (displayedTime >= 10) {
                document.querySelector("#timer").innerHTML = displayedTime;
            }
            else {                              //Always two integer digits
                document.querySelector("#timer").innerHTML = "0" + displayedTime;
            }

            if (time <= 0) {                    //Time's up
                clearInterval(interval);

                waitForCollision = true;        //Don't take other commands
                if (firstPerson) {
                    camera = currentRobot.thirdPersonCamera;
                    currentRobot.aimToIdle();
                }
                else {
                    currentRobot.walkToIdle();
                }
                //Reset all flags to stop all ongoing actions
                moveForward = false;
                moveBackward = false;
                turnLeft = false;
                turnRight = false;
                aimUp = false;
                aimDown = false;

                //Remove gui
                document.querySelector("#crosshair").style.display = "none";
                document.querySelector("#power").style.display = "none";

                //Robot becomes static again
                currentRobot.body.mass = 0;
                currentRobot.body.type = CANNON.Body.STATIC;
                currentRobot.body.updateMassProperties();

                nextTurn();
            }
        }, 10);
    }

    //Charge up the shot and then shoot
    function chargeShot() {                     //Increases a counter
        let power = 0;
        let approximation;                      //Number displayed on the gui (one decimal digit)

        let interval = setInterval(() => {
            power += 0.1;
            approximation = Math.round(power * 100) / 100;
            document.querySelector("#power").innerHTML = "POWER: " + approximation;

            if (!charging || power >= 10) {     //Stopped charging or max charge
                //Remove gui
                document.querySelector("#crosshair").style.display = "none";
                document.querySelector("#power").style.display = "none";
                camera = currentRobot.thirdPersonCamera;
                clearInterval(interval);        //Stop loop

                //Robot becomes static again
                currentRobot.body.mass = 0;
                currentRobot.body.type = CANNON.Body.STATIC;
                currentRobot.body.updateMassProperties();
                
                //Create new bullet, shoot and wait for next turn
                const bulletBody = bullet(power);
                bulletBody.addEventListener("collide", endTurn);
                currentRobot.shoot();

                document.querySelector("#power").innerHTML = "POWER: " + 0;
            }
        }, 13.5);
    }

    //Shoot a new bullet
    function bullet(power) {
        //Bullet
        const bulletRadius = 0.2;
        const segments = 8;
        const bulletGeometry = new THREE.SphereGeometry(bulletRadius, segments, segments);
        const bulletMaterial = new THREE.MeshPhongMaterial({color: "gray"});
        const bulletMesh = new THREE.Mesh(bulletGeometry, bulletMaterial);

        //Bullet initial position
        let initialCoords = new THREE.Vector3();
        currentRobot.rightHand.getWorldPosition(initialCoords);     //Hand gives the bullet's initial coordinates
        bulletMesh.position.set(initialCoords.x, initialCoords.y, initialCoords.z);
        bulletMesh.castShadow = true;
        bulletMesh.receiveShadow = true;

        //Bullet physics
        const bulletShape = new CANNON.Sphere(bulletRadius);
        const bulletBody = new CANNON.Body({mass: 1});
        bulletBody.addShape(bulletShape);

        //Break the shot vector over the three axes
        const effectivePower = power * 3.6;             //Scale up the power (or else too weak)
        const horizontalAngle = currentRobot.waist.rotation.y;
        const verticalAngle = currentRobot.head.rotation.x;
        const powerY = effectivePower * Math.sin(verticalAngle);
        const projection = effectivePower * Math.cos(verticalAngle);     //Project the vector on the xz plane
        const powerX = projection * -Math.sin(horizontalAngle);
        const powerZ = projection * -Math.cos(horizontalAngle);
        bulletBody.position.set(initialCoords.x, initialCoords.y, initialCoords.z);
        bulletBody.velocity.set(powerX, powerY, powerZ);

        bullets.push(bulletMesh);
        scene.add(bulletMesh);
        bulletBodies.push(bulletBody);
        world.addBody(bulletBody);

        return bulletBody;          //Used for bullet listener to detect the first collision*/
    }

    //Look for the bullet's collision which ends the turn
    function endTurn(e) {
        this.removeEventListener("collide", endTurn);  //Remove listener from bullet (detect only one collision)
        let missed = true;
        
        for (let i=0; i < world.contacts.length; i++) { //Scan all contacts
            let c = world.contacts[i];
            //Check if contact is between the bullet and a robot (red or blue)
            redRobots.forEach(robot => {
                if ((c.bi === this && c.bj === robot.body) || (c.bi === robot.body && c.bj === this)) {
                    robot.decreaseHealth();
                    if (robot.health <= 0) {            //Remove the dead robot
                        const index = redRobots.indexOf(robot);
                        redRobots.splice(index, 1);
                        numRedRobots--;
                    }
                    if (currentRobot.team != robot.team) {      //Enemy hit
                        document.querySelector("#hit").innerHTML = "You've hit an enemy!";
                    }
                    else {                                      //Ally hit
                        document.querySelector("#hit").innerHTML = "You've hit an ally!";
                    }
                    document.querySelector("#hit").style.display = "block";
                    missed = false;
                }
            });
            blueRobots.forEach(robot => {
                if ((c.bi === this && c.bj === robot.body) || (c.bi === robot.body && c.bj === this)) {
                    robot.decreaseHealth();
                    if (robot.health <= 0) {            //Remove the dead robot
                        const index = blueRobots.indexOf(robot);
                        blueRobots.splice(index, 1);
                        numBlueRobots--;
                    }
                    if (currentRobot.team != robot.team) {      //Enemy hit
                        document.querySelector("#hit").innerHTML = "You've hit an enemy!";
                    }
                    else {                                      //Ally hit
                        document.querySelector("#hit").innerHTML = "You've hit an ally!";
                    }
                    document.querySelector("#hit").style.display = "block";
                    missed = false;
                }
            });
        }
        if (missed) {                           //Missed
            document.querySelector("#hit").innerHTML = "You missed!";
            document.querySelector("#hit").style.display = "block";
        }

        nextTurn();
    }

    //Go to next player's turn
    function nextTurn() {
        //Last team remaining is the winner
        if (redRobots.length == 0) {            //No more red robots
            gameOver("BLUE");
        }
        else if (blueRobots.length == 0) {      //No more blue robots
            gameOver("RED");
        }
        //Change turn some time after the collision
        else {
            setTimeout(() => {
                if (nextRed) {
                    blueRobotIndex = (blueRobotIndex + 1) % numBlueRobots;  //Increase counter for blue team
                    redRobotIndex = redRobotIndex % numRedRobots;           //numRedRobots could have decreased
                    currentRobot = redRobots[redRobotIndex];                //Next robot is red
                }
                else {
                    redRobotIndex = (redRobotIndex + 1) % numRedRobots;     //Increase counter for red team
                    blueRobotIndex = blueRobotIndex % numBlueRobots;        //numBlueRobots could have decreased
                    currentRobot = blueRobots[blueRobotIndex];              //Next robot is blue
                }
                nextRed = !nextRed;
                camera = currentRobot.thirdPersonCamera;    //Switch to next robot's camera

                //The new robot becomes dynamic
                currentRobot.body.mass = robotMass;
                currentRobot.body.type = CANNON.Body.DYNAMIC;
                currentRobot.body.updateMassProperties();

                global = false;                             //Reset flags
                firstPerson = false;
                waitForCollision = false;

                document.querySelector("#hit").innerHTML = "";
                document.querySelector("#hit").style.display = "none";

                document.querySelector("#timer").innerHTML = turnTime;
                countdown();
            }, 1800);
        }
    }

    //Move the robot (applying forces in case)
    function move() {
        const speed = 2.9;
        //Speed over x and z and how much the robot rotates
        const speedX = Math.sin(currentRobot.waist.rotation.y) * speed;
        const speedZ = Math.cos(currentRobot.waist.rotation.y) * speed;
        const rotation = 0.02;

        //No if-else so that you can use them together

        if (!moveForward && !moveBackward) {
            currentRobot.body.velocity.set(0, 0, 0);
        }

        if (moveBackward) {
            currentRobot.body.velocity.set(speedX, 0, speedZ);                  //Move body
            currentRobot.waist.position.x = currentRobot.body.position.x;       //Move mesh accordingly
            currentRobot.waist.position.z = currentRobot.body.position.z;
        }
        if (moveForward) {
            currentRobot.body.velocity.set(-speedX, 0, -speedZ);                //Move body
            currentRobot.waist.position.x = currentRobot.body.position.x;       //Move mesh accordingly
            currentRobot.waist.position.z = currentRobot.body.position.z;
        }

        if (turnLeft && !firstPerson) {
            currentRobot.waist.rotation.y += rotation;
        }
        if (turnRight && !firstPerson) {
            currentRobot.waist.rotation.y += -rotation;
        }
    }

    //Aim when in first person
    function aim() {
        //How much the robot rotates
        const horizontalRotation = 0.003;
        const verticalRotation = 0.005;

        //No if-else so that you can use them together
        if (aimUp && currentRobot.head.rotation.x < Math.PI / 3) {      //Max angle
            currentRobot.head.rotation.x += verticalRotation;
            currentRobot.rightShoulder.rotation.x += verticalRotation;
        }
        if (aimDown && currentRobot.head.rotation.x > -Math.PI / 8) {   //Min angle
            currentRobot.head.rotation.x += -verticalRotation;
            currentRobot.rightShoulder.rotation.x += -verticalRotation;
        }
        if (turnLeft && firstPerson) {
            currentRobot.waist.rotation.y += horizontalRotation;
        }
        if (turnRight && firstPerson) {
            currentRobot.waist.rotation.y += -horizontalRotation;
        }
    }

    function gameOver(team) {                   //Victory screen
        document.removeEventListener("keydown", handleKeyDown);     //Remove listeners
        document.removeEventListener("keyup", handleKeyUp);

        const gui = document.querySelector("#gameOver");            //Create game over message with buttons
        gui.innerHTML = team + " TEAM WINS! <br>"+
                        "<button class=end-button id=newGame>New game</button>" +
                        "<button class=end-button id=mainMenu>Main menu</button> <br>";
        gui.style.color = team;

        const newGameButton = document.querySelector("#newGame");
        newGameButton.style.backgroundColor = team;
        newGameButton.onclick = () => {
            resetGame();
            main();
        }

        const menuButton = document.querySelector("#mainMenu");
        menuButton.style.backgroundColor = team;
        menuButton.onclick = () => {
            resetGame();
            menu();
        }

        gui.style.display = "block";

        function resetGame() {
            while (scene.children.length > 0) {
                scene.remove(scene.children[0]);
            }
            while (world.bodies.length > 0) {
                world.removeBody(world.bodies[0]);
            }
            world = null;
        }
    }

    function render() {
        //Step the physics world
        world.step(1/60);

        //Move the robot
        move();
        aim();
        TWEEN.update();

        //We move the body but want the rotation we give to the mesh
        currentRobot.body.quaternion.copy(currentRobot.waist.quaternion);

        //Copy coordinates from Cannon to Three for each bullet
        bullets.forEach((bullet, index) => {
            bullet.position.copy(bulletBodies[index].position);
            bullet.quaternion.copy(bulletBodies[index].quaternion);
        });

        //The aspect of the cameras matches the aspect of the canvas (no distortions)
        if (resizeRendererToDisplaySize(renderer)) {
            const canvas = renderer.domElement;
            redRobots.forEach(robot => {
                resizeAspect(robot, canvas);
            });
            blueRobots.forEach(robot => {
                resizeAspect(robot, canvas);
            });
            globalCamera.aspect = canvas.clientWidth / canvas.clientHeight;
            globalCamera.updateProjectionMatrix();
        }

        renderer.render(scene, camera);
        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
}

export {main};