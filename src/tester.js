import commander from 'commander';
import Listr from 'listr';
import fs from 'fs';
import path from 'path';
import execa from 'execa';
import { Observable } from 'rxjs';
import chalk from 'chalk';

commander.command('test <program> <bruteforce> <generator>')
    .description('test your python program')
    .option('-c --count <count>', 'how many tests', 10)
    .option('-r --remove', 'remove directory after testing')
    .option('--python3', 'use python3 command instead of just python')
    .option('--exe', 'use program that is already compiled to the executable')
    .action(async (program, bruteforce, generator, options) => {
        let tasks = [];

        // create tests directory
        await fs.mkdir(path.join(process.cwd(), 'generated-tests'), (err) => {
            if (err) {
                return console.error(err);
            }
        });
        let testsPath = path.join(process.cwd(), 'generated-tests');

        //create error list
        let errors = [];

        // create tests
        for (let i = 0; i < parseInt(options.count); i++) {
            tasks.push({
                title: `Test ${i}`,
                task: () => {
                    return new Observable(async observer => {
                        // generate test
                        let subprocess = null;
                        try {
                            observer.next('Generating test');
                            subprocess = null;
                            if (options.exe) {
                                subprocess = execa(generator);
                            } else {
                                subprocess = execa(options.python3 ? 'python3' : 'python', [generator]);
                            }
                            subprocess.stdout.pipe(fs.createWriteStream(path.join(testsPath, `test-${i}.in`)));
                            await subprocess;
                        } catch (err) {
                            errors.push({
                                type: 'generation',
                                error: err,
                                num: i
                            });
                            await subprocess.cancel();
                            observer.complete();
                            return;
                        }

                        // run bruteforce version
                        try {
                            observer.next('Running bruteforce');
                            if (options.exe) {
                                subprocess = execa(bruteforce);
                            } else {
                                subprocess = execa(options.python3 ? 'python3' : 'python', [bruteforce]);
                            }
                            subprocess.stdout.pipe(fs.createWriteStream(path.join(testsPath, `bruteforce-${i}.out`)));
                            fs.createReadStream(path.join(testsPath, `test-${i}.in`)).pipe(subprocess.stdin);
                            await subprocess;
                        } catch (err) {
                            errors.push({
                                type: 'bruteforce',
                                error: err,
                                num: i
                            });
                            await subprocess.cancel();
                            observer.complete();
                            return;
                        }

                        // run normal version
                        try {
                            observer.next('Running your program');
                            if (options.exe) {
                                subprocess = execa(program);
                            } else {
                                subprocess = execa(options.python3 ? 'python3' : 'python', [program]);
                            }
                            subprocess.stdout.pipe(fs.createWriteStream(path.join(testsPath, `program-${i}.out`)));
                            fs.createReadStream(path.join(testsPath, `test-${i}.in`)).pipe(subprocess.stdin);
                            await subprocess;
                        } catch (err) {
                            errors.push({
                                type: 'program',
                                error: err,
                                num: i
                            });
                            await subprocess.cancel();
                            observer.complete();
                            return;
                        }


                        // compare results
                        fs.readFile(path.join(testsPath, `bruteforce-${i}.out`), (err, data) => {
                            if (err) {
                                errors.push({
                                    type: 'compare',
                                    error: err,
                                    num: i
                                });
                            }

                            fs.readFile(path.join(testsPath, `program-${i}.out`), (err, data1) => {
                                if (err) {
                                    errors.push({
                                        type: 'compare',
                                        error: err,
                                        num: i
                                    });
                                }

                                if (!data.equals(data1)) {
                                    errors.push({
                                        type: 'result',
                                        error: '---->Got:\n' + data1 + '\n---->But Expected:\n' + data,
                                        num: i
                                    });
                                }
                            })
                        })

                        observer.complete();
                    });
                }
            });
        }

        await new Listr(tasks).run().catch((err) => {
            console.error(err);
            return;
        });

        for (let err of errors) {
            console.log('\n');
            console.log(chalk.yellow(`Test id: Test ${err.num}`))
            if (err.type == 'generation') {
                console.log(chalk.red.bold('Error while generating test'));
            } else if (err.type == 'bruteforce') {
                console.log(chalk.red.bold('Error while running bruteforce'));
            } else if (err.type == 'program') {
                console.log(chalk.red.bold('Error while running your program'));
            } else if (err.type = 'result') {
                console.log(chalk.red.bold('Bad result'));
            } else {
                console.log(chalk.red.bold('Error while comparing results'));
            }
            console.log(chalk.red(err.error));
        }

        if (options.remove) {
            fs.rmSync(testsPath, { recursive: true, force: true });
        }

    });

commander.parse(process.argv);